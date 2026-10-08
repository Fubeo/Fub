// @vitest-environment happy-dom
// La sezione «Sfumatura», da sola, su un editor finto che cambia come gli
// si chiede: il tipo, la barra coi punti come cursori, i gesti col
// puntatore e coi tasti, i campi del punto scelto coi loro errori, il
// selettore del sistema, le sfumature pronte, l'angolo, oltre i capi
// all'Esperto, la sola lettura, «Applica a» e la lingua.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import type { DrawKey } from "../strings";
import { createGradientPanel, stripImage, type GradientPanel, type GradientPanelView } from "./gradient-panel";
import { fadeOf, GRADIENT_PRESETS, reversedStops, sortedStops, type GradientChange, type GradientStop, type GradientView } from "./gradients";
import type { PaintTarget } from "./swatches-panel";

const BLUE_WHITE: GradientStop[] = [
  { offset: 0, color: "#0072b2", opacity: 1 },
  { offset: 1, color: "#ffffff", opacity: 1 },
];

const THREE: GradientStop[] = [
  { offset: 0, color: "#0072b2", opacity: 1 },
  { offset: 0.5, color: "#f0e442", opacity: 0.5 },
  { offset: 1, color: "#ffffff", opacity: 1 },
];

const linear = (stops: readonly GradientStop[], more: Partial<GradientView> = {}): GradientView => ({
  count: 1,
  gradients: 1,
  kind: "linear",
  based: false,
  look: { kind: "linear", stops, spread: "pad" },
  angle: 0,
  ...more,
});

const SOLID: GradientView = { count: 1, gradients: 0, kind: "color", based: true, look: null, angle: null };

/// Un oggetto col riempimento a sfumatura e il contorno pieno.
function viewOf(more: Partial<GradientPanelView> = {}): GradientPanelView {
  return {
    key: "oa",
    channels: { fill: linear(BLUE_WHITE), stroke: SOLID },
    stop: null,
    expert: false,
    swatches: [{ name: "Blu marca", color: "#0072b2" }],
    ...more,
  };
}

/// La vista `view` con `change`, come la scriverebbe l'editor.
function changed(view: GradientView, change: GradientChange): GradientView {
  const look = view.look;
  if ("stops" in change) {
    const kind = look?.kind ?? "linear";
    return { ...view, kind, gradients: view.count, look: { kind, stops: sortedStops(change.stops), spread: look?.spread ?? "pad" }, angle: view.angle ?? 0 };
  }
  if ("kind" in change) {
    if (change.kind === "color") return SOLID;
    return { ...view, kind: change.kind, gradients: view.count, look: { kind: change.kind, stops: look?.stops ?? fadeOf("#d55e00"), spread: look?.spread ?? "pad" }, angle: view.angle ?? 0 };
  }
  if (look === null) return view;
  if ("reverse" in change) return { ...view, look: { ...look, stops: reversedStops(look.stops) } };
  if ("spread" in change) return { ...view, look: { ...look, spread: change.spread } };
  if ("fade" in change) return { ...view, look: { ...look, stops: fadeOf(look.stops[0]!.color) } };
  if ("angle" in change) return { ...view, angle: change.angle };
  return view;
}

interface Sent {
  readonly target: PaintTarget;
  readonly change: GradientChange;
  readonly label: DrawKey;
}

let host: HTMLElement;
let life: Lifetime;
let panel: GradientPanel;
let state: { view: GradientPanelView; editable: boolean };
let sent: Sent[];
let calls: string[];
let previews: Array<GradientChange | null>;
let announced: string[];
/// Ciò che l'editor risponde a un cambio: `null` se lo fa.
let refusal: string | null;

const update = (): void => panel.update(state.view, state.editable);

/// La sezione su un editor finto, che cambia la vista come farebbe
/// l'editor.
function mount(view: GradientPanelView = viewOf(), editable = true): GradientPanel {
  state = { view, editable };
  panel = createGradientPanel(life, {
    onChange: (target, change, label) => {
      sent.push({ target, change, label });
      if (refusal !== null) return refusal;
      const before = state.view.channels[target]!;
      state.view = { ...state.view, channels: { ...state.view.channels, [target]: changed(before, change) } };
      update();
      return null;
    },
    onPreview: (target, change) => {
      expect(target).toBe("fill");
      previews.push(change);
    },
    onStop: (index) => {
      calls.push(`stop ${index}`);
      state.view = { ...state.view, stop: index };
      update();
    },
    onTarget: (target) => {
      calls.push(`target ${target}`);
    },
    announce: (text) => announced.push(text),
  });
  host.append(panel.element);
  update();
  return panel;
}

const one = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
const thumbs = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".draw-gradient-thumb")];
const kindButton = (kind: string): HTMLButtonElement => one<HTMLButtonElement>(`[data-kind="${kind}"]`);
const targetRow = (): HTMLElement => one(".draw-gradient-target");
const targetButton = (target: PaintTarget): HTMLButtonElement => targetRow().querySelector<HTMLButtonElement>(`[data-target="${target}"]`)!;
const stopsGroup = (): HTMLElement => one(".draw-gradient-stops");
const strip = (): HTMLElement => one(".draw-gradient-strip");
const bar = (): HTMLElement => one(".draw-gradient-bar");
const stopFields = (): HTMLElement => stopsGroup().querySelector<HTMLElement>(".draw-gradient-fields")!;
const stopTitle = (): string => stopFields().querySelector(".draw-gradient-stop-title")!.textContent!;
const textInputs = (): HTMLInputElement[] => [...stopFields().querySelectorAll<HTMLInputElement>('input[type="text"]')];
const colorInput = (): HTMLInputElement => textInputs()[0]!;
const offsetInput = (): HTMLInputElement => textInputs()[1]!;
const opacityInput = (): HTMLInputElement => textInputs()[2]!;
const picker = (): HTMLInputElement => stopFields().querySelector<HTMLInputElement>('input[type="color"]')!;
const stopError = (): HTMLElement => stopFields().querySelector<HTMLElement>(".draw-properties-error")!;
const removeButton = (): HTMLButtonElement => one<HTMLButtonElement>(".draw-gradient-remove");
const actions = (): HTMLElement => one(".draw-gradient > .draw-properties-bar");
const actionButtons = (): HTMLButtonElement[] => [...actions().querySelectorAll<HTMLButtonElement>("button")];
const [addButton, reverseButton, presetsButton] = [0, 1, 2].map((at) => (): HTMLButtonElement => actionButtons()[at]!);
const more = (): HTMLElement => [...host.querySelectorAll<HTMLElement>(".draw-gradient > .draw-gradient-fields")][0]!;
const angleInput = (): HTMLInputElement => more().querySelector<HTMLInputElement>("input")!;
const angleError = (): HTMLElement => more().querySelector<HTMLElement>(".draw-properties-error")!;
const note = (): HTMLElement => one(".draw-gradient > .draw-properties-note");
const spreadRow = (): HTMLElement => one<HTMLButtonElement>('[data-spread="pad"]').closest<HTMLElement>(".draw-gradient-row")!;
const spreadButton = (spread: string): HTMLButtonElement => one<HTMLButtonElement>(`[data-spread="${spread}"]`);
const pressed = (buttons: readonly HTMLButtonElement[]): string[] => buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent!);
const kinds = (): HTMLButtonElement[] => ["color", "linear", "radial"].map(kindButton);
const selectedThumb = (): number => thumbs().findIndex((thumb) => thumb.hasAttribute("data-selected"));
const lastSent = (): Sent => sent[sent.length - 1]!;
/// I punti mandati per ultimi, come si leggono.
const stopsSent = (): string[] => {
  const change = lastSent().change;
  return "stops" in change ? change.stops.map((stop) => `${stop.color} ${stop.offset} ${stop.opacity}`) : [];
};

function key(name: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target!.dispatchEvent(event);
  return event;
}

function click(target: Element, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
}

function type(input: HTMLInputElement, text: string): void {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pointer(kind: string, target: Element, clientX: number, clientY = 40): void {
  target.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX, clientY }));
}

/// La barra misurata: larga 200 px da 12 px, alta 56 px dall'alto.
function measure(): void {
  const rect = (left: number, top: number, width: number, height: number): DOMRect =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  strip().getBoundingClientRect = () => rect(12, 0, 200, 24);
  bar().getBoundingClientRect = () => rect(0, 0, 224, 56);
}

/// Il menu aperto per ultimo: quello chiuso può restare un momento, mentre
/// esce.
const menu = (): HTMLElement => {
  const open = document.querySelectorAll<HTMLElement>(".context-menu");
  return open[open.length - 1]!;
};
const entries = (): HTMLButtonElement[] => [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const entry = (label: string): HTMLButtonElement => entries().find((each) => each.querySelector(".menu-label")!.textContent === label)!;

const READ_ONLY = "Modifica non applicata: il disegno è in sola lettura.";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  sent = [];
  calls = [];
  previews = [];
  announced = [];
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

describe("la sezione", () => {
  it("ha «Applica a», il tipo, la barra coi punti, i campi del punto scelto, i comandi e l'angolo, coi loro nomi", () => {
    mount();
    expect(targetRow().hidden).toBe(false);
    expect(targetRow().querySelector(".draw-properties-label")!.textContent).toBe("Applica a");
    expect(pressed([targetButton("fill"), targetButton("stroke")])).toEqual(["Riempimento"]);
    expect(kinds().map((button) => button.textContent)).toEqual(["Pieno", "Lineare", "Radiale"]);
    expect(pressed(kinds())).toEqual(["Lineare"]);
    expect(note().hidden).toBe(true);
    // La barra è un gruppo coi punti come cursori, ciascuno col suo nome.
    const label = stopsGroup().querySelector(".draw-properties-label")!;
    expect(stopsGroup().getAttribute("role")).toBe("group");
    expect(stopsGroup().getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.textContent).toBe("Punti della sfumatura");
    expect(strip().getAttribute("aria-hidden")).toBe("true");
    expect(strip().style.getPropertyValue("--gradient-image")).toBe(stripImage(BLUE_WHITE));
    expect(thumbs().map((thumb) => [thumb.getAttribute("role"), thumb.tabIndex, thumb.getAttribute("aria-label"), thumb.getAttribute("aria-valuenow"), thumb.getAttribute("aria-valuetext")])).toEqual([
      ["slider", 0, "Punto 1 di 2", "0", "Blu, al 0%"],
      ["slider", 0, "Punto 2 di 2", "100", "#ffffff, al 100%"],
    ]);
    expect(thumbs().map((thumb) => thumb.style.getPropertyValue("--at"))).toEqual(["0", "1"]);
    expect(selectedThumb()).toBe(0);
    // I campi sono del punto scelto, in un gruppo che lui nomina.
    expect(stopFields().getAttribute("aria-labelledby")).toBe(stopFields().querySelector(".draw-gradient-stop-title")!.id);
    expect(stopTitle()).toBe("Punto 1 di 2");
    expect([...stopFields().querySelectorAll("label")].map((each) => each.textContent)).toEqual(["Colore", "Posizione", "Opacità"]);
    expect([colorInput().value, offsetInput().value, opacityInput().value, picker().value]).toEqual(["#0072b2", "0", "100", "#0072b2"]);
    expect(picker().getAttribute("aria-label")).toBe("Colore: selettore del sistema");
    expect(removeButton().getAttribute("aria-label")).toBe("Togli il punto 1");
    // Con due punti, togliere resta raggiungibile e dice perché no.
    expect(removeButton().getAttribute("aria-disabled")).toBe("true");
    expect(removeButton().title).toBe("Togli il punto 1 — Una sfumatura ha almeno due punti.");
    expect(actions().getAttribute("aria-label")).toBe("Sfumatura");
    expect(actionButtons().map((button) => [button.getAttribute("aria-label"), button.hidden])).toEqual([
      ["Aggiungi un punto", false],
      ["Inverti", false],
      ["Sfumature pronte", false],
    ]);
    expect(presetsButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(more().hidden).toBe(false);
    expect(more().querySelector("label")!.textContent).toBe("Angolo");
    expect(angleInput().value).toBe("0");
    // «Oltre i capi» è dell'Esperto.
    expect(spreadRow().hidden).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("dice il colore e l'opacità di un punto trasparente, e i numeri nella lingua dell'app", () => {
    mount(viewOf({ channels: { fill: linear([{ offset: 0, color: "#d55e00", opacity: 1 }, { offset: 0.375, color: "#000000", opacity: 0.255 }]) } }));
    expect(thumbs()[1]!.getAttribute("aria-valuetext")).toBe("Nero con opacità 25,5%, al 37,5%");
    expect(thumbs()[1]!.getAttribute("aria-valuenow")).toBe("37.5");
    expect(stripImage([{ offset: 0, color: "#000000", opacity: 0.255 }, { offset: 1, color: "#ffffff", opacity: 1 }])).toBe("linear-gradient(to right, #00000041 0%, #ffffff 100%)");
    // Senza contorno, «Applica a» non c'è.
    expect(targetRow().hidden).toBe(true);
  });

  it("con un colore pieno ha il tipo e le sfumature pronte, e dice che cosa ne nasce", () => {
    mount(viewOf({ channels: { fill: SOLID } }));
    expect(pressed(kinds())).toEqual(["Pieno"]);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe("Lineare e Radiale fanno del colore di adesso una sfumatura, da pieno a trasparente.");
    expect(stopsGroup().hidden).toBe(true);
    expect(actionButtons().map((button) => button.hidden)).toEqual([true, true, false]);
    expect(more().hidden).toBe(true);
    // Lineare: il colore diventa la sua sfumatura, e il punto scelto il primo.
    click(kindButton("linear"));
    expect(lastSent()).toEqual({ target: "fill", change: { kind: "linear" }, label: "draw.action.gradient_kind" });
    expect(calls).toEqual(["stop 0"]);
    expect(stopsGroup().hidden).toBe(false);
    expect(note().hidden).toBe(true);
    // Pieno torna al colore, senza un punto scelto.
    click(kindButton("color"));
    expect(lastSent().change).toEqual({ kind: "color" });
    expect(calls).toEqual(["stop 0", "stop null"]);
    // Il tipo che c'è già non manda niente.
    click(kindButton("color"));
    expect(sent).toHaveLength(2);
  });

  it("senza colore dice che la sfumatura nasce dal bianco al nero", () => {
    mount(viewOf({ channels: { fill: { ...SOLID, kind: "other", based: false } } }));
    expect(pressed(kinds())).toEqual([]);
    expect(note().textContent).toBe("Lineare e Radiale danno una sfumatura dal bianco al nero; o scegline una pronta.");
  });

  it("con una campitura o un motivo non ha un tipo, e la sfumatura nasce dal loro colore", () => {
    mount(viewOf({ channels: { fill: { ...SOLID, kind: "other" } } }));
    expect(pressed(kinds())).toEqual([]);
    expect(note().textContent).toBe("Lineare e Radiale fanno del colore di adesso una sfumatura, da pieno a trasparente.");
  });

  it("con sfumature diverse ha il tipo, le pronte, «Inverti» e l'angolo, che vale per tutte", () => {
    mount(viewOf({ channels: { fill: { count: 2, gradients: 2, kind: null, based: false, look: null, angle: null } } }));
    expect(pressed(kinds())).toEqual([]);
    expect(note().textContent).toBe("Gli oggetti scelti hanno sfumature diverse: il tipo, le sfumature pronte, «Inverti» e l’angolo valgono per tutti, ciascuno coi suoi colori.");
    expect(stopsGroup().hidden).toBe(true);
    expect(actionButtons().map((button) => button.hidden)).toEqual([true, false, false]);
    expect(more().hidden).toBe(false);
    expect(angleInput().value).toBe("");
    expect(angleInput().placeholder).toBe("Misto");
    // Su e giù non ha da dove partire.
    angleInput().focus();
    key("ArrowUp");
    expect(sent).toEqual([]);
    expect(announced).toEqual(["I valori sono diversi: scrivi quello da dare a tutti."]);
    type(angleInput(), "30");
    key("Enter");
    expect(lastSent()).toEqual({ target: "fill", change: { angle: 30 }, label: "draw.action.gradient_angle" });
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("i punti dalla tastiera", () => {
  it("si spostano dell'1%, del 10% con Maiusc e con Pagina, e ai capi con Inizio e Fine; il fuoco li segue", () => {
    mount(viewOf({ channels: { fill: linear(THREE) } }));
    thumbs()[1]!.focus();
    expect(calls).toEqual(["stop 1"]);
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(lastSent().label).toBe("draw.action.gradient_stop_move");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#f0e442 0.51 0.5", "#ffffff 1 1"]);
    key("ArrowLeft", { shiftKey: true });
    expect(stopsSent()[1]).toBe("#f0e442 0.41 0.5");
    key("PageUp");
    expect(stopsSent()[1]).toBe("#f0e442 0.51 0.5");
    key("ArrowDown");
    expect(stopsSent()[1]).toBe("#f0e442 0.5 0.5");
    // Su un altro punto, il punto resta dalla parte da cui arriva.
    key("Home");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#f0e442 0 0.5", "#ffffff 1 1"]);
    expect(document.activeElement).toBe(thumbs()[1]);
    expect(thumbs()[1]!.getAttribute("aria-valuetext")).toBe("Giallo con opacità 50%, al 0%");
    key("End");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#f0e442 1 0.5", "#ffffff 1 1"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un punto spostato oltre un altro passa dall'altra parte, e il fuoco con lui", () => {
    const green = { offset: 0.55, color: "#009e73", opacity: 1 };
    mount(viewOf({ channels: { fill: linear([THREE[0]!, THREE[1]!, green, THREE[2]!]) } }));
    thumbs()[1]!.focus();
    key("ArrowRight", { shiftKey: true });
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#009e73 0.55 1", "#f0e442 0.6 0.5", "#ffffff 1 1"]);
    expect(document.activeElement).toBe(thumbs()[2]);
    expect(selectedThumb()).toBe(2);
    expect(calls).toEqual(["stop 1", "stop 2"]);
    expect(stopTitle()).toBe("Punto 3 di 4");
  });

  it("Ins aggiunge un punto a metà col seguente, Canc lo toglie se ne restano due", () => {
    mount();
    thumbs()[0]!.focus();
    key("Insert");
    expect(lastSent().label).toBe("draw.action.gradient_stop_add");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#80b9d9 0.5 1", "#ffffff 1 1"]);
    expect(announced).toEqual(["Punto 2 aggiunto, al 50%."]);
    expect(document.activeElement).toBe(thumbs()[1]);
    expect(selectedThumb()).toBe(1);
    key("Delete");
    expect(lastSent().label).toBe("draw.action.gradient_stop_remove");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#ffffff 1 1"]);
    expect(announced[announced.length - 1]).toBe("Punto 2 tolto.");
    expect(document.activeElement).toBe(thumbs()[1]);
    // Con due punti, Canc dice perché no.
    key("Backspace");
    expect(sent).toHaveLength(2);
    expect(announced[announced.length - 1]).toBe("Una sfumatura ha almeno due punti.");
    // «+» come Ins, dall'ultimo punto a metà col precedente.
    key("+");
    expect(stopsSent()[1]).toBe("#80b9d9 0.5 1");
  });

  it("i tasti con un modificatore restano all'editor", () => {
    mount();
    thumbs()[0]!.focus();
    expect(key("ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("Escape").defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe("i punti col puntatore", () => {
  it("un punto si trascina lungo la barra: il disegno lo mostra, e lasciato è un passo solo", () => {
    mount(viewOf({ channels: { fill: linear(THREE) } }));
    measure();
    const thumb = thumbs()[1]!;
    pointer("pointerdown", thumb, 112);
    expect(document.activeElement).toBe(thumb);
    expect(calls).toEqual(["stop 1"]);
    // Sotto la soglia non si muove.
    pointer("pointermove", thumb, 113);
    expect(previews).toEqual([]);
    pointer("pointermove", thumb, 162);
    expect(thumbs()[1]!.style.getPropertyValue("--at")).toBe("0.75");
    expect(previews).toEqual([{ stops: [THREE[0], { ...THREE[1], offset: 0.75 }, THREE[2]] }]);
    expect(sent).toEqual([]);
    pointer("pointerup", thumb, 162);
    expect(previews[previews.length - 1]).toBeNull();
    expect(sent).toHaveLength(1);
    expect(lastSent().label).toBe("draw.action.gradient_stop_move");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#f0e442 0.75 0.5", "#ffffff 1 1"]);
    expect(document.activeElement).toBe(thumbs()[1]);
  });

  it("un punto trascinato lontano dalla barra si toglie, se ne restano almeno due", () => {
    mount(viewOf({ channels: { fill: linear(THREE) } }));
    measure();
    const thumb = thumbs()[1]!;
    pointer("pointerdown", thumb, 112);
    pointer("pointermove", thumb, 112, 120);
    expect(thumb.hasAttribute("data-torn")).toBe(true);
    expect(previews).toEqual([{ stops: [THREE[0], THREE[2]] }]);
    pointer("pointerup", thumb, 112, 120);
    expect(lastSent().label).toBe("draw.action.gradient_stop_remove");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#ffffff 1 1"]);
    expect(announced).toEqual(["Punto 2 tolto."]);
    // Con due punti, lontano dalla barra il punto si sposta e basta.
    const first = thumbs()[0]!;
    pointer("pointerdown", first, 12);
    pointer("pointermove", first, 62, 120);
    expect(first.hasAttribute("data-torn")).toBe(false);
    pointer("pointerup", first, 62, 120);
    expect(stopsSent()).toEqual(["#0072b2 0.25 1", "#ffffff 1 1"]);
  });

  it("un trascinamento interrotto, o lasciato con Esc, non scrive niente", () => {
    mount(viewOf({ channels: { fill: linear(THREE) } }));
    measure();
    const thumb = thumbs()[1]!;
    pointer("pointerdown", thumb, 112);
    pointer("pointermove", thumb, 162);
    pointer("pointercancel", thumb, 162);
    expect(previews[previews.length - 1]).toBeNull();
    expect(thumbs()[1]!.style.getPropertyValue("--at")).toBe("0.5");
    pointer("pointerdown", thumb, 112);
    pointer("pointermove", thumb, 162);
    expect(key("Escape", {}, thumb).defaultPrevented).toBe(true);
    pointer("pointerup", thumb, 162);
    expect(sent).toEqual([]);
    expect(thumbs()[1]!.style.getPropertyValue("--at")).toBe("0.5");
  });

  it("un clic sulla barra aggiunge un punto del colore che si vede lì, che prende il fuoco", () => {
    mount();
    measure();
    click(strip(), { clientX: 112 });
    expect(lastSent().label).toBe("draw.action.gradient_stop_add");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#80b9d9 0.5 1", "#ffffff 1 1"]);
    expect(announced).toEqual(["Punto 2 aggiunto, al 50%."]);
    expect(document.activeElement).toBe(thumbs()[1]);
    expect(selectedThumb()).toBe(1);
    expect(stopTitle()).toBe("Punto 2 di 3");
    expect(colorInput().value).toBe("#80b9d9");
  });
});

describe("i campi del punto scelto", () => {
  it("il colore si scrive come codice, come nome o col nome di un campione del documento", () => {
    mount();
    type(colorInput(), "red");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(lastSent()).toMatchObject({ target: "fill", label: "draw.action.gradient_stop_color" });
    expect(stopsSent()).toEqual(["#ff0000 0 1", "#ffffff 1 1"]);
    expect(colorInput().value).toBe("#ff0000");
    expect(picker().value).toBe("#ff0000");
    type(colorInput(), "blu MARCA");
    key("Enter");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#ffffff 1 1"]);
    // Lo stesso colore non manda niente.
    type(colorInput(), "0072B2");
    key("Enter");
    expect(sent).toHaveLength(2);
    expect(colorInput().value).toBe("#0072b2");
  });

  it("un colore che non è un colore resta scritto, e dice che cosa non va", () => {
    mount();
    type(colorInput(), "verdino");
    key("Enter");
    expect(sent).toEqual([]);
    expect(colorInput().value).toBe("verdino");
    expect(stopError().hidden).toBe(false);
    expect(stopError().textContent).toBe("Scrivi un colore: un codice come #0072b2 o un nome come red.");
    expect(colorInput().getAttribute("aria-invalid")).toBe("true");
    expect(colorInput().getAttribute("aria-describedby")).toBe(stopError().id);
    expect(announced).toEqual(["Scrivi un colore: un codice come #0072b2 o un nome come red."]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Esc torna al colore del disegno, e toglie l'errore.
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(colorInput().value).toBe("#0072b2");
    expect(stopError().hidden).toBe(true);
    expect(colorInput().hasAttribute("aria-invalid")).toBe(false);
    // Senza niente da annullare, Esc va all'editor.
    expect(key("Escape").defaultPrevented).toBe(false);
  });

  it("la posizione e l'opacità si scrivono in percentuale, anche come calcolo, e con su e giù", () => {
    mount(viewOf({ channels: { fill: linear(THREE) }, stop: 1 }));
    expect([colorInput().value, offsetInput().value, opacityInput().value]).toEqual(["#f0e442", "50", "50"]);
    expect(offsetInput().getAttribute("role")).toBe("spinbutton");
    expect(offsetInput().getAttribute("aria-valuenow")).toBe("50");
    type(offsetInput(), "20+5");
    key("Enter");
    expect(lastSent().label).toBe("draw.action.gradient_stop_move");
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#f0e442 0.25 0.5", "#ffffff 1 1"]);
    expect(offsetInput().value).toBe("25");
    offsetInput().focus();
    key("ArrowUp", { shiftKey: true });
    expect(stopsSent()[1]).toBe("#f0e442 0.35 0.5");
    type(opacityInput(), "80");
    opacityInput().blur();
    expect(lastSent().label).toBe("draw.action.gradient_stop_opacity");
    expect(stopsSent()[1]).toBe("#f0e442 0.35 0.8");
    // Fuori da 0 e 100, il valore si ferma ai capi.
    type(opacityInput(), "150");
    key("Enter");
    expect(stopsSent()[1]).toBe("#f0e442 0.35 1");
    expect(opacityInput().value).toBe("100");
  });

  it("un punto spostato oltre un altro resta il punto scelto", () => {
    mount(viewOf({ channels: { fill: linear(THREE) }, stop: 0 }));
    type(offsetInput(), "75");
    key("Enter");
    expect(stopsSent()).toEqual(["#f0e442 0.5 0.5", "#0072b2 0.75 1", "#ffffff 1 1"]);
    expect(calls[calls.length - 1]).toBe("stop 1");
    expect(stopTitle()).toBe("Punto 2 di 3");
    expect([colorInput().value, offsetInput().value]).toEqual(["#0072b2", "75"]);
  });

  it("un numero che non si legge resta scritto, e dice che cosa non va", () => {
    mount();
    type(offsetInput(), "metà");
    key("Enter");
    expect(sent).toEqual([]);
    expect(stopError().textContent).toBe("Scrivi un numero o un calcolo, come 120+15.");
    expect(offsetInput().getAttribute("aria-invalid")).toBe("true");
    expect(colorInput().hasAttribute("aria-invalid")).toBe(false);
  });

  it("il selettore del sistema mostra il colore sul disegno mentre si muove, e lo scrive quando si sceglie", () => {
    mount();
    picker().value = "#00ff00";
    picker().dispatchEvent(new Event("input", { bubbles: true }));
    expect(previews).toEqual([{ stops: [{ ...BLUE_WHITE[0], color: "#00ff00" }, BLUE_WHITE[1]] }]);
    expect(colorInput().value).toBe("#00ff00");
    expect(strip().style.getPropertyValue("--gradient-image")).toContain("#00ff00");
    expect(sent).toEqual([]);
    picker().dispatchEvent(new Event("change", { bubbles: true }));
    expect(previews[previews.length - 1]).toBeNull();
    expect(stopsSent()).toEqual(["#00ff00 0 1", "#ffffff 1 1"]);
    // Lasciato senza scegliere, il disegno torna com'era.
    picker().focus();
    picker().value = "#ff00ff";
    picker().dispatchEvent(new Event("input", { bubbles: true }));
    picker().blur();
    expect(previews[previews.length - 1]).toBeNull();
    expect(colorInput().value).toBe("#00ff00");
    expect(sent).toHaveLength(1);
  });

  it("un cambio rifiutato resta scritto, e il campo dice perché", () => {
    mount();
    refusal = "Modifica non applicata: il livello è bloccato.";
    type(opacityInput(), "40");
    key("Enter");
    expect(opacityInput().value).toBe("40");
    expect(stopError().textContent).toBe("Modifica non applicata: il livello è bloccato.");
    expect(announced).toEqual(["Modifica non applicata: il livello è bloccato."]);
    expect(calls).toEqual([]);
  });

  it("«Togli il punto» toglie il punto scelto, e il seguente diventa quello scelto", () => {
    mount(viewOf({ channels: { fill: linear(THREE) }, stop: 1 }));
    expect(removeButton().hasAttribute("aria-disabled")).toBe(false);
    expect(removeButton().title).toBe("Togli il punto 2");
    click(removeButton());
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#ffffff 1 1"]);
    expect(calls).toEqual(["stop 1"]);
    expect(stopTitle()).toBe("Punto 2 di 2");
    click(removeButton());
    expect(sent).toHaveLength(1);
    expect(announced[announced.length - 1]).toBe("Una sfumatura ha almeno due punti.");
  });
});

describe("i comandi", () => {
  it("«Aggiungi un punto» lo mette a metà fra il punto scelto e il seguente; «Inverti» rovescia i punti", () => {
    mount();
    click(addButton());
    expect(stopsSent()).toEqual(["#0072b2 0 1", "#80b9d9 0.5 1", "#ffffff 1 1"]);
    expect(calls).toEqual(["stop 1"]);
    // Il fuoco resta al pulsante.
    click(reverseButton());
    expect(lastSent()).toEqual({ target: "fill", change: { reverse: true }, label: "draw.action.gradient_reverse" });
    expect(calls[calls.length - 1]).toBe("stop 1");
  });

  it("le sfumature pronte stanno in un menu, coi loro colori e quella di adesso scelta", () => {
    const sky = GRADIENT_PRESETS.find((preset) => preset.id === "sky")!.stops!;
    mount(viewOf({ channels: { fill: linear(sky) } }));
    click(presetsButton());
    expect(entries().map((each) => [each.querySelector(".menu-label")!.textContent, each.getAttribute("aria-checked")])).toEqual([
      ["Dissolvenza", "false"],
      ["Dal bianco al nero", "false"],
      ["Cielo", "true"],
      ["Tramonto", "false"],
      ["Prato", "false"],
      ["Crepuscolo", "false"],
    ]);
    expect(entry("Dissolvenza").querySelector(".menu-description")!.textContent).toBe("Il primo colore, da pieno a trasparente");
    expect(entry("Tramonto").querySelectorAll(".menu-swatches > *")).toHaveLength(4);
    click(entry("Tramonto"));
    expect(lastSent()).toEqual({ target: "fill", change: { stops: GRADIENT_PRESETS[3]!.stops }, label: "draw.action.gradient_preset" });
    expect(calls).toEqual(["stop 0"]);
    click(presetsButton());
    click(entry("Dissolvenza"));
    expect(lastSent().change).toEqual({ fade: true });
  });

  it("l'angolo si scrive in gradi, fra -180 e 180, e con su e giù", () => {
    mount(viewOf({ channels: { fill: linear(BLUE_WHITE, { angle: 12.5 }) } }));
    expect(angleInput().value).toBe("12,5");
    expect(angleInput().getAttribute("aria-valuenow")).toBe("12.5");
    type(angleInput(), "270");
    key("Enter");
    expect(lastSent()).toEqual({ target: "fill", change: { angle: -90 }, label: "draw.action.gradient_angle" });
    expect(angleInput().value).toBe("-90");
    angleInput().focus();
    key("ArrowDown");
    expect(lastSent().change).toEqual({ angle: -91 });
    type(angleInput(), "45°");
    key("Enter");
    expect(lastSent().change).toEqual({ angle: 45 });
    type(angleInput(), "tanto");
    key("Enter");
    expect(sent).toHaveLength(3);
    expect(angleError().hidden).toBe(false);
    expect(angleInput().getAttribute("aria-describedby")).toBe(angleError().id);
  });

  it("all'Esperto c'è come la sfumatura continua oltre i capi", () => {
    mount(viewOf({ expert: true }));
    expect(spreadRow().hidden).toBe(false);
    expect(spreadRow().querySelector(".draw-properties-label")!.textContent).toBe("Oltre i capi");
    const spreads = ["pad", "reflect", "repeat"].map(spreadButton);
    expect(spreads.map((button) => button.textContent)).toEqual(["Estendi", "Rifletti", "Ripeti"]);
    expect(pressed(spreads)).toEqual(["Estendi"]);
    click(spreadButton("reflect"));
    expect(lastSent()).toEqual({ target: "fill", change: { spread: "reflect" }, label: "draw.action.gradient_spread" });
    expect(pressed(spreads)).toEqual(["Rifletti"]);
    // Le scelte sono una barra col roving tabindex.
    expect(spreads.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("«Applica a», la selezione e la sola lettura", () => {
  it("«Applica a» sceglie il contorno, lo dice all'editor e mostra la sua sfumatura; scelto altrove, no", () => {
    mount(viewOf({ channels: { fill: linear(BLUE_WHITE), stroke: linear(THREE) } }));
    click(targetButton("stroke"));
    expect(calls).toEqual(["target stroke"]);
    expect(panel.target()).toBe("stroke");
    expect(pressed([targetButton("fill"), targetButton("stroke")])).toEqual(["Contorno"]);
    expect(thumbs()).toHaveLength(3);
    panel.setTarget("fill");
    expect(calls).toEqual(["target stroke"]);
    expect(thumbs()).toHaveLength(2);
    // Un bersaglio che la selezione non ha cede a quello che ha.
    state.view = viewOf({ channels: { stroke: linear(THREE) } });
    update();
    expect(panel.target()).toBe("fill");
    expect(thumbs()).toHaveLength(3);
    expect(targetRow().hidden).toBe(true);
  });

  it("un'altra selezione riporta i campi al disegno, anche quelli scritti a metà", () => {
    mount();
    type(offsetInput(), "30");
    state.view = { ...state.view, stop: 1 };
    update();
    expect(offsetInput().value).toBe("100");
    type(offsetInput(), "30");
    // Lo stesso punto della stessa selezione tiene ciò che si scrive.
    update();
    expect(offsetInput().value).toBe("30");
    state.view = viewOf({ key: "ob", stop: 1 });
    update();
    expect(offsetInput().value).toBe("100");
  });

  it("in sola lettura la sfumatura si guarda: ogni gesto dice perché no", () => {
    mount(viewOf({ channels: { fill: linear(THREE) }, expert: true }), false);
    measure();
    expect(kinds().map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"]);
    expect(thumbs().map((thumb) => thumb.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"]);
    expect(bar().hasAttribute("data-readonly")).toBe(true);
    expect([colorInput().readOnly, offsetInput().readOnly, opacityInput().readOnly, angleInput().readOnly, picker().disabled]).toEqual([true, true, true, true, true]);
    expect(actionButtons().map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"]);
    expect(spreadButton("repeat").getAttribute("aria-disabled")).toBe("true");
    click(kindButton("radial"));
    thumbs()[1]!.focus();
    key("ArrowRight");
    key("Delete");
    click(strip(), { clientX: 60 });
    click(addButton());
    pointer("pointerdown", thumbs()[1]!, 112);
    pointer("pointermove", thumbs()[1]!, 162);
    pointer("pointerup", thumbs()[1]!, 162);
    expect(sent).toEqual([]);
    expect(previews).toEqual([]);
    expect(announced).toEqual([READ_ONLY, READ_ONLY, READ_ONLY, READ_ONLY, READ_ONLY]);
    // Il punto si sceglie e si legge comunque.
    expect(calls).toEqual(["stop 1"]);
    expect(stopTitle()).toBe("Punto 2 di 3");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("riscrive i testi e i numeri nella lingua dell'app", () => {
    mount(viewOf({ channels: { fill: linear(THREE, { angle: 12.5 }), stroke: SOLID }, expert: true }));
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(targetRow().querySelector(".draw-properties-label")!.textContent).toBe("Apply to");
    expect(kinds().map((button) => button.textContent)).toEqual(["Solid", "Linear", "Radial"]);
    expect(thumbs()[1]!.getAttribute("aria-valuetext")).toBe("Yellow with 50% opacity, at 50%");
    expect(thumbs()[1]!.getAttribute("aria-label")).toBe("Stop 2 of 3");
    expect(stopsGroup().querySelector(".draw-properties-label")!.textContent).toBe("Gradient stops");
    expect([...stopFields().querySelectorAll("label")].map((each) => each.textContent)).toEqual(["Color", "Position", "Opacity"]);
    expect(actionButtons().map((button) => button.getAttribute("aria-label"))).toEqual(["Add a stop", "Reverse", "Gradient presets"]);
    expect(angleInput().value).toBe("12.5");
    expect(spreadRow().querySelector(".draw-properties-label")!.textContent).toBe("Beyond the ends");
  });
});
