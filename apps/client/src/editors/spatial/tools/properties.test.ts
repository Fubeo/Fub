// @vitest-environment happy-dom
// Il pannello delle proprietà da solo, con un editor finto che tiene i
// valori: le sezioni, i numeri che si calcolano, i colori, le scelte, i
// comandi e un disegno che cambia mentre si scrive.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { iconEl, iconNames } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import {
  createProperties,
  type ActionState,
  type FieldId,
  type FieldState,
  type FieldSwatch,
  type MenuChoiceState,
  type NumberState,
  type PaintContrast,
  type Properties,
  type PropertiesView,
  type SectionId,
} from "./properties";
import { lengthUnits, PERCENT_UNITS } from "./quantity";
import type { PaintSample } from "./resources";
import { TIP_SHAPES } from "./tips";

let host: HTMLElement;
let life: Lifetime;
let panel: Properties;
let announced: string[];
let calls: string[];
let refusal: string | null;
let closed: SectionId[];
let state: {
  key: string;
  editable: boolean;
  x: number;
  y: number;
  width: number | null;
  opacity: number;
  fill: string | null;
  sample: PaintSample | null;
  /// Il contrasto del riempimento con la carta, se si misura.
  contrast: PaintContrast | null;
  /// I campioni del documento e i colori recenti, se il pannello li sa.
  swatches: FieldSwatch[] | null;
  recent: string[] | null;
  dash: string | null;
  anchor: string | null;
  bold: boolean | null;
  italic: boolean | null;
  ratio: boolean;
  grid: boolean;
  desc: string;
  actions: Partial<Record<string, ActionState>>;
  /// Le punte delle due estremità, se i campi a menu ci sono.
  tips: { start: TipLook; end: TipLook } | null;
  only: FieldId[] | null;
};

/// La punta di un capo: la forma (`null` se sono più d'una) e la misura.
type TipLook = { shape: string | null; size: string };

const length = (value: number | null, label: string): NumberState => ({
  kind: "number",
  label,
  value,
  unit: "mm",
  units: lengthUnits("mm"),
  relative: true,
  places: 3,
});

const TIP_SHAPE_NAMES: Array<[string, string]> = [
  ["none", "Nessuna"],
  ["triangle", "Triangolo"],
  ["circle", "Cerchio"],
];
const TIP_SIZE_NAMES: Array<[string, string]> = [
  ["small", "Piccola"],
  ["medium", "Media"],
  ["large", "Grande"],
];

/// Il campo della punta di un capo come lo dà l'editor: le forme con la loro
/// figura, le misure, che dove non c'è una punta si vedono e non si scelgono,
/// e lo scambio, che è un comando.
function tipMenu(end: "start" | "end", look: TipLook): MenuChoiceState {
  const shape = TIP_SHAPE_NAMES.find(([value]) => value === look.shape);
  const size = TIP_SIZE_NAMES.find(([value]) => value === look.size)![1].toLowerCase();
  return {
    kind: "menu",
    label: end === "start" ? "Punta d’inizio" : "Punta di fine",
    value: look.shape,
    summary: shape === undefined ? "Misto" : look.shape === "none" ? shape[1] : `${shape[1]}, ${size}`,
    options: [
      ...TIP_SHAPE_NAMES.map(([value, label]) => ({ value, label, icon: value === "none" ? "draw-tip-none" : `draw-tip-${value}-${end}`, checked: look.shape === value })),
      ...TIP_SIZE_NAMES.map(([value, label], at) => ({
        value: `size:${value}`,
        label,
        checked: look.size === value,
        ...(look.shape === "none" ? { disabled: true } : {}),
        ...(at === 0 ? { separator: true } : {}),
      })),
      { value: "swap", label: "Scambia inizio e fine", icon: "draw-tips-swap", action: true, separator: true },
    ],
  };
}

function view(): PropertiesView {
  const fields: Partial<Record<FieldId, FieldState>> = {
    x: length(state.x, "X"),
    y: length(state.y, "Y"),
    width: { ...length(state.width, "Larghezza"), min: 0.01 },
    ratio: { kind: "press", label: "Mantieni le proporzioni", on: state.ratio },
    opacity: { kind: "number", label: "Opacità", value: state.opacity, unit: "%", units: PERCENT_UNITS, relative: false, places: 0, min: 0, max: 100 },
    fill: {
      kind: "paint",
      label: "Riempimento",
      value: state.fill,
      ...(state.sample === null ? {} : { sample: state.sample }),
      ...(state.contrast === null ? {} : { contrast: state.contrast }),
    },
    dash: {
      kind: "choice",
      label: "Tratteggio",
      value: state.dash,
      options: [
        { value: "solid", label: "Continuo" },
        { value: "dashed", label: "Tratteggiato" },
      ],
    },
    anchor: {
      kind: "segment",
      label: "Allineamento",
      value: state.anchor,
      options: [
        { value: "start", label: "A sinistra", icon: "draw-anchor-start" },
        { value: "middle", label: "Al centro", icon: "draw-anchor-middle" },
        { value: "end", label: "A destra", icon: "draw-anchor-end" },
      ],
    },
    emphasis: {
      kind: "toggles",
      label: "Enfasi",
      options: [
        { value: "bold", label: "Grassetto", icon: "draw-text-bold", on: state.bold },
        { value: "italic", label: "Corsivo", icon: "draw-text-italic", on: state.italic },
      ],
    },
    grid: { kind: "switch", label: "Mostra la griglia", on: state.grid, note: "Le righe si vedono soltanto qui." },
    desc: { kind: "text", label: "Descrizione", value: state.desc },
  };
  if (state.tips !== null) {
    fields.tipStart = tipMenu("start", state.tips.start);
    fields.tipEnd = tipMenu("end", state.tips.end);
  }
  const shown = state.only === null ? fields : Object.fromEntries(state.only.map((id) => [id, fields[id]]));
  return {
    key: state.key,
    subject: "Rettangolo",
    editable: state.editable,
    fields: shown,
    actions: state.actions,
    ...(state.swatches === null ? {} : { swatches: state.swatches }),
    ...(state.recent === null ? {} : { recent: state.recent }),
  };
}

/// Come il pannello mostra il colore `value`: un campione del documento col
/// suo nome e il suo colore.
function sampleOf(value: string): PaintSample | null {
  const id = /^url\(#([^)\s]+)\)/.exec(value)?.[1];
  const swatch = state.swatches?.find((each) => each.id === id);
  return swatch === undefined ? null : { kind: "swatch", image: null, name: swatch.name, color: swatch.color };
}

/// Un cambio come l'editor lo scrive: il valore, e il pannello che lo segue.
function change(id: FieldId, value: number | string | boolean): string | null {
  calls.push(`${id}=${String(value)}`);
  if (refusal !== null) return refusal;
  if (id === "x") state.x = value as number;
  else if (id === "width") state.width = value as number;
  else if (id === "opacity") state.opacity = value as number;
  else if (id === "fill") {
    state.fill = value as string;
    state.sample = sampleOf(value as string);
  }
  else if (id === "dash") state.dash = value as string;
  else if (id === "anchor") state.anchor = value as string;
  else if (id === "emphasis") {
    const [which, on] = (value as string).split(":");
    state[which as "bold" | "italic"] = on === "true";
  }
  else if (id === "ratio") state.ratio = value as boolean;
  else if (id === "grid") state.grid = value as boolean;
  else if (id === "desc") state.desc = value as string;
  else if ((id === "tipStart" || id === "tipEnd") && state.tips !== null) {
    const end = id === "tipStart" ? "start" : "end";
    const text = value as string;
    if (text.startsWith("size:")) state.tips[end] = { ...state.tips[end], size: text.slice("size:".length) };
    else if (text !== "swap") state.tips[end] = { ...state.tips[end], shape: text };
  }
  panel.update(view());
  return null;
}

function mount(): Properties {
  panel = createProperties(life, {
    closed,
    onChange: change,
    onAction: (id) => calls.push(`action ${id}`),
    onSection: (id, open) => calls.push(`section ${id} ${open ? "open" : "closed"}`),
    onExportSelection: () => calls.push("export selection"),
    announce: (text) => announced.push(text),
    onLeave: () => calls.push("leave"),
  });
  host.append(panel.element);
  panel.update(view());
  return panel;
}

const field = (id: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-properties-field[data-field="${id}"]`)!;
const input = (id: string): HTMLInputElement => field(id).querySelector<HTMLInputElement>(".draw-properties-input")!;
const error = (id: string): HTMLElement => field(id).querySelector<HTMLElement>(".draw-properties-error")!;
const section = (id: SectionId): HTMLElement => host.querySelector<HTMLElement>(`.draw-properties-section[data-section="${id}"]`)!;
const toggle = (id: SectionId): HTMLButtonElement => section(id).querySelector<HTMLButtonElement>(".draw-properties-toggle")!;
const action = (id: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;

/// Scrive `text` nel campo, come chi lo digita.
function write(target: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  announced = [];
  calls = [];
  refusal = null;
  closed = [];
  state = {
    key: "oaaaaaaaa",
    editable: true,
    x: 12.5,
    y: 40,
    width: 80,
    opacity: 100,
    fill: "#0072b2",
    sample: null,
    contrast: null,
    swatches: null,
    recent: null,
    dash: "solid",
    anchor: "start",
    bold: null,
    italic: false,
    ratio: false,
    grid: false,
    desc: "",
    actions: {},
    tips: null,
    only: null,
  };
});

afterEach(() => {
  life.close();
  host.remove();
});

describe("il pannello", () => {
  it("è una regione col suo titolo, l'oggetto, e le sezioni che hanno qualcosa da mostrare", () => {
    mount();
    expect(panel.element.tagName).toBe("SECTION");
    expect(host.querySelector(".draw-properties-title")!.textContent).toBe("Proprietà");
    expect(host.querySelector(".draw-properties-subject")!.textContent).toBe("Rettangolo");
    const visible = [...host.querySelectorAll<HTMLElement>(".draw-properties-section")].filter((each) => !each.hidden).map((each) => each.dataset.section);
    expect(visible).toEqual(["place", "look", "fill", "stroke", "text", "document", "view"]);
    expect(toggle("place").textContent).toBe("Posizione e misure");
    expect(toggle("place").getAttribute("aria-expanded")).toBe("true");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("mostra un numero nell'unità del campo, con la sigla nel nome", () => {
    mount();
    const x = input("x");
    expect(x.value).toBe("12,5");
    expect(x.getAttribute("role")).toBe("spinbutton");
    expect(x.getAttribute("aria-valuenow")).toBe("12.5");
    expect(x.getAttribute("aria-valuetext")).toBe("12,5 mm");
    const label = field("x").querySelector("label")!;
    expect(label.htmlFor).toBe(x.id);
    expect(label.textContent).toBe("X (mm)");
    expect(field("x").querySelector(".draw-properties-unit")!.textContent).toBe("mm");
  });

  it("dice «Misto» per i valori diversi, senza un valore", () => {
    state.width = null;
    state.fill = null;
    state.dash = null;
    mount();
    expect(input("width").value).toBe("");
    expect(input("width").placeholder).toBe("Misto");
    expect(input("width").hasAttribute("aria-valuenow")).toBe(false);
    expect(input("width").getAttribute("aria-valuetext")).toBe("Misto");
    expect(input("fill").placeholder).toBe("Misto");
    const dash = field("dash").querySelector("select")!;
    expect(dash.value).toBe("");
    expect(dash.options[0]!.textContent).toBe("Misto");
    expect(dash.options[0]!.disabled).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("i numeri", () => {
  it("si calcolano e partono con Invio", () => {
    mount();
    write(input("x"), "120+15");
    expect(press(input("x"), "Enter").defaultPrevented).toBe(true);
    expect(calls).toEqual(["x=135"]);
    expect(input("x").value).toBe("135");
    write(input("x"), "1in");
    press(input("x"), "Enter");
    expect(calls).toEqual(["x=135", "x=25.4"]);
    expect(input("x").value).toBe("25,4");
  });

  it("partono lasciando il campo, e la percentuale è una parte del valore", () => {
    mount();
    write(input("width"), "50%");
    input("width").blur();
    expect(calls).toEqual(["width=40"]);
    expect(input("width").value).toBe("40");
  });

  it("restano nei limiti del campo, e uno uguale a quello di adesso non parte", () => {
    mount();
    write(input("opacity"), "150");
    press(input("opacity"), "Enter");
    expect(calls).toEqual([]);
    expect(input("opacity").value).toBe("100");
    write(input("opacity"), "40-60");
    press(input("opacity"), "Enter");
    expect(calls).toEqual(["opacity=0"]);
    write(input("x"), "12.5");
    press(input("x"), "Enter");
    expect(calls).toEqual(["opacity=0"]);
    expect(input("x").value).toBe("12,5");
  });

  it("che non si leggono restano scritti, col messaggio; a voce solo con Invio", () => {
    mount();
    write(input("x"), "12+");
    input("x").blur();
    expect(calls).toEqual([]);
    expect(input("x").value).toBe("12+");
    expect(error("x").hidden).toBe(false);
    expect(error("x").textContent).toBe("Scrivi un numero o un calcolo, come 120+15.");
    expect(input("x").getAttribute("aria-invalid")).toBe("true");
    expect(input("x").getAttribute("aria-describedby")).toBe(error("x").id);
    expect(announced).toEqual([]);
    write(input("x"), "12em");
    press(input("x"), "Enter");
    expect(announced).toEqual(["Qui valgono queste unità: px, mm, cm, in, pt."]);
    // Un aggiornamento del disegno non cancella ciò che non è partito.
    panel.update(view());
    expect(input("x").value).toBe("12em");
    write(input("x"), "14");
    press(input("x"), "Enter");
    expect(calls).toEqual(["x=14"]);
    expect(error("x").hidden).toBe(true);
    expect(input("x").hasAttribute("aria-invalid")).toBe(false);
  });

  it("rifiutati dal disegno restano scritti, con la ragione", () => {
    mount();
    refusal = "Il livello è bloccato.";
    write(input("x"), "30");
    press(input("x"), "Enter");
    expect(calls).toEqual(["x=30"]);
    expect(input("x").value).toBe("30");
    expect(error("x").textContent).toBe("Il livello è bloccato.");
    expect(announced).toEqual(["Il livello è bloccato."]);
  });

  it("cambiano di 1 con su e giù, di 10 con Maiusc, e partono subito", () => {
    mount();
    expect(press(input("x"), "ArrowUp").defaultPrevented).toBe(true);
    expect(calls).toEqual(["x=13.5"]);
    expect(input("x").value).toBe("13,5");
    press(input("x"), "ArrowDown", { shiftKey: true });
    expect(calls).toEqual(["x=13.5", "x=3.5"]);
    // Si parte da ciò che è scritto, se si legge.
    write(input("x"), "20mm");
    press(input("x"), "ArrowUp");
    expect(calls[calls.length - 1]).toBe("x=21");
    // Ai limiti il valore non cambia.
    press(input("opacity"), "ArrowUp");
    expect(calls[calls.length - 1]).toBe("x=21");
  });

  it("misti non hanno da dove partire con le frecce, e lo dicono", () => {
    state.width = null;
    mount();
    press(input("width"), "ArrowUp");
    expect(calls).toEqual([]);
    expect(announced).toEqual(["I valori sono diversi: scrivi quello da dare a tutti."]);
    write(input("width"), "50%");
    press(input("width"), "Enter");
    expect(calls).toEqual([]);
    expect(error("width").textContent).toBe("I valori sono diversi, e una percentuale non ha di che essere parte: scrivi un numero.");
    write(input("width"), "30");
    press(input("width"), "Enter");
    expect(calls).toEqual(["width=30"]);
  });

  it("con Esc tornano a com'erano, e di nuovo il fuoco torna al foglio", () => {
    mount();
    write(input("x"), "99");
    press(input("x"), "Escape");
    expect(input("x").value).toBe("12,5");
    expect(calls).toEqual([]);
    press(input("x"), "Escape");
    expect(calls).toEqual(["leave"]);
  });

  it("scritti a metà restano mentre il disegno cambia, e se ne vanno con un'altra selezione", () => {
    mount();
    write(input("x"), "70");
    state.x = 20;
    panel.update(view());
    expect(input("x").value).toBe("70");
    state.key = "obbbbbbbb";
    panel.update(view());
    expect(input("x").value).toBe("20");
    expect(calls).toEqual([]);
  });
});

describe("i colori", () => {
  it("si vedono col codice e col campione, e si scrivono col codice, col nome o con «nessuno»", () => {
    mount();
    const fill = input("fill");
    expect(fill.value).toBe("#0072b2");
    const frame = field("fill").querySelector<HTMLElement>(".draw-swatch-frame")!;
    expect(frame.dataset.shape).toBe("circle");
    write(fill, "red");
    // Il campione segue ciò che si scrive, tondo per ogni colore.
    expect(frame.dataset.shape).toBe("circle");
    expect(field("fill").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch")).toBe("#ff0000");
    press(fill, "Enter");
    expect(calls).toEqual(["fill=#ff0000"]);
    expect(fill.value).toBe("#ff0000");
    write(fill, "nessuno");
    press(fill, "Enter");
    expect(calls).toEqual(["fill=#ff0000", "fill=none"]);
    expect(fill.value).toBe("Nessuno");
    expect(frame.dataset.shape).toBe("none");
  });

  it("una sfumatura o un motivo si vedono col loro nome e col loro campione", () => {
    const image = "linear-gradient(to right, rgb(255 255 255 / 1) 0%, rgb(0 0 0 / 1) 100%)";
    state.fill = "url(#rgggggggg)";
    state.sample = { kind: "gradient", image };
    mount();
    const fill = input("fill");
    const frame = field("fill").querySelector<HTMLElement>(".draw-swatch-frame")!;
    const swatch = field("fill").querySelector<HTMLElement>(".draw-swatch")!;
    expect(fill.value).toBe("Sfumatura");
    expect(frame.dataset.shape).toBe("gradient");
    expect(swatch.style.getPropertyValue("--swatch-image")).toBe(image);
    // Invio senza cambiare niente non scrive.
    press(fill, "Enter");
    expect(calls).toEqual([]);
    // Un colore scritto prende il posto del campione.
    write(fill, "#ff0000");
    expect(frame.dataset.shape).toBe("circle");
    expect(swatch.style.getPropertyValue("--swatch-image")).toBe("");
    press(fill, "Escape");
    expect(frame.dataset.shape).toBe("gradient");
    state.fill = "url(#rpppppppp)";
    state.sample = { kind: "pattern", image: null };
    panel.update(view());
    expect(fill.value).toBe("Motivo");
    expect(frame.dataset.shape).toBe("pattern");
    expect(swatch.style.getPropertyValue("--swatch-image")).toBe("");
  });

  it("che non sono colori restano scritti, col messaggio", () => {
    mount();
    write(input("fill"), "rossiccio");
    press(input("fill"), "Enter");
    expect(calls).toEqual([]);
    expect(error("fill").textContent).toBe("Scrivi un colore: un codice come #0072b2, un nome come red, o «nessuno».");
  });

  it("si scelgono col selettore del kit, in un passo alla fine", () => {
    mount();
    const chip = field("fill").querySelector<HTMLButtonElement>(".draw-properties-chip")!;
    expect(field("fill").querySelector(".draw-properties-picker")).toBeNull();
    chip.click();
    const code = picker().querySelector<HTMLInputElement>(".kit-color-input")!;
    code.value = "#009e73";
    code.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(calls).toEqual(["fill=#009e73"]);
    // Un secondo clic sul campione lo chiude.
    chip.click();
    expect(document.querySelector(".kit-color-popover")).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
  });

  it("il campione apre il selettore, con nessuno e i consigliati col loro nome, e niente formine", () => {
    mount();
    const chip = field("fill").querySelector<HTMLButtonElement>(".draw-properties-chip")!;
    expect(chip.getAttribute("aria-label")).toBe("Riempimento: campioni");
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
    chip.click();
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(pickerGroups()).toEqual([["Consigliati", "Nessuno", "Nero", "Blu", "Vermiglio", "Verde", "Porpora", "Arancione", "Azzurro", "Giallo"]]);
    expect(swatch("Blu").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-shape='square'], [data-shape='triangle']")).toBeNull();
    swatch("Verde").click();
    expect(calls).toEqual(["fill=#009e73"]);
    swatch("Nessuno").click();
    expect(calls).toEqual(["fill=#009e73", "fill=none"]);
  });
});

/// Il selettore del colore aperto.
const picker = (): HTMLElement => document.querySelector<HTMLElement>(".kit-color-popover .kit-color")!;

/// I nomi dei campioni del selettore, gruppo per gruppo.
const pickerGroups = (): string[][] =>
  [...picker().querySelectorAll<HTMLElement>(".kit-color-group")].map((group) => [
    group.querySelector(".kit-color-group-title")!.textContent!,
    ...[...group.querySelectorAll<HTMLElement>(".kit-color-swatch")].map((each) => each.getAttribute("aria-label")!),
  ]);

/// Il campione del selettore che si chiama `name`.
const swatch = (name: string): HTMLButtonElement => picker().querySelector<HTMLButtonElement>(`.kit-color-swatch[aria-label="${name}"]`)!;

describe("i campioni del documento nei colori", () => {
  const BRAND: FieldSwatch = { id: "ra", name: "Blu marca", color: "#0072b2" };
  const PAPER: FieldSwatch = { id: "rb", name: "Fondo", color: "#f5f5dc" };

  beforeEach(() => {
    state.swatches = [BRAND, PAPER];
    state.fill = "url(#ra) #0072b2";
    state.sample = sampleOf(state.fill);
  });

  const chipOf = (): HTMLElement => field("fill").querySelector<HTMLElement>(".draw-swatch-frame")!;
  const colorOf = (): string => field("fill").querySelector<HTMLElement>(".draw-swatch")!.style.getPropertyValue("--swatch");

  it("un campione si vede col suo nome e col suo colore", () => {
    mount();
    expect(input("fill").value).toBe("Blu marca");
    expect([chipOf().dataset.shape, colorOf()]).toEqual(["circle", "#0072b2"]);
  });

  it("si scrive col suo nome, senza badare alle maiuscole; il codice scrive il colore, staccato dal campione", () => {
    mount();
    const fill = input("fill");
    // Lo stesso campione non cambia niente.
    write(fill, "BLU MARCA");
    press(fill, "Enter");
    expect(calls).toEqual([]);
    expect(fill.value).toBe("Blu marca");
    // Mentre si scrive, il campione segue.
    write(fill, "fondo");
    expect([chipOf().dataset.shape, colorOf()]).toEqual(["circle", "#f5f5dc"]);
    press(fill, "Enter");
    expect(calls).toEqual(["fill=url(#rb) #f5f5dc"]);
    expect(fill.value).toBe("Fondo");
    write(fill, "#f5f5dc");
    press(fill, "Enter");
    expect(calls).toEqual(["fill=url(#rb) #f5f5dc", "fill=#f5f5dc"]);
    expect(fill.value).toBe("#f5f5dc");
  });

  it("il nome di un campione vale prima del nome di un colore", () => {
    state.swatches = [BRAND, { id: "rc", name: "Red", color: "#e30613" }];
    mount();
    write(input("fill"), "red");
    press(input("fill"), "Enter");
    expect(calls).toEqual(["fill=url(#rc) #e30613"]);
  });

  it("ciò che non è niente lo dice, coi campioni fra ciò che si può scrivere", () => {
    mount();
    write(input("fill"), "rossiccio");
    press(input("fill"), "Enter");
    expect(calls).toEqual([]);
    expect(error("fill").textContent).toBe("Scrivi un colore: un codice come #0072b2, un nome come red, il nome di un campione, o «nessuno».");
    // Esc torna al campione, col suo colore.
    press(input("fill"), "Escape");
    expect(input("fill").value).toBe("Blu marca");
    expect([chipOf().dataset.shape, colorOf()]).toEqual(["circle", "#0072b2"]);
  });

  it("il selettore ha nessuno, i consigliati, i campioni e i recenti che non ne sono; un colore di un campione lo lega", () => {
    state.recent = ["#3a7bd5", "#0072b2"];
    mount();
    field("fill").querySelector<HTMLButtonElement>(".draw-properties-chip")!.click();
    expect(pickerGroups()).toEqual([
      ["Consigliati", "Nessuno", "Nero", "Blu", "Vermiglio", "Verde", "Porpora", "Arancione", "Azzurro", "Giallo"],
      ["Colori del documento", "Blu marca", "Fondo"],
      ["Recenti", "#3a7bd5"],
    ]);
    swatch("Fondo").click();
    expect(calls).toEqual(["fill=url(#rb) #f5f5dc"]);
  });
});

describe("il contrasto con la carta", () => {
  const line = (): HTMLElement => field("fill").querySelector<HTMLElement>(".draw-properties-contrast")!;

  it("per una forma dice il rapporto e se basta; il campo lo ha fra le sue descrizioni", () => {
    state.fill = "#000000";
    state.contrast = { paper: "#ffffff", alpha: 1, text: false };
    mount();
    expect(line().hidden).toBe(false);
    expect(line().textContent).toBe("Contrasto con la carta 21:1: basta per una forma, che chiede 3:1.");
    expect(input("fill").getAttribute("aria-describedby")!.split(" ")).toContain(line().id);
    // Mentre si scrive segue il colore; uno che non si legge lascia quello
    // di adesso.
    write(input("fill"), "#ffffff");
    expect(line().textContent).toBe("Contrasto con la carta 1:1: poco per una forma, che chiede 3:1.");
    write(input("fill"), "boh");
    expect(line().textContent).toBe("Contrasto con la carta 21:1: basta per una forma, che chiede 3:1.");
  });

  it("per un testo dice il livello del testo normale e del grande, per difetto", () => {
    state.fill = "#767676";
    state.contrast = { paper: "#ffffff", alpha: 1, text: true };
    mount();
    expect(line().textContent).toBe("Contrasto con la carta 4,54:1. Testo normale: AA; testo grande: AAA.");
    write(input("fill"), "#000000");
    expect(line().textContent).toBe("Contrasto con la carta 21:1. Testo normale: AAA; testo grande: AAA.");
    write(input("fill"), "#ffffff");
    expect(line().textContent).toBe("Contrasto con la carta 1:1. Testo normale: insufficiente; testo grande: insufficiente.");
  });

  it("conta l'opacità, e un campione col suo colore; non il nessuno né il misto", () => {
    state.fill = "#000000";
    state.contrast = { paper: "#ffffff", alpha: 0, text: false };
    mount();
    expect(line().textContent).toBe("Contrasto con la carta 1:1: poco per una forma, che chiede 3:1.");
    state.swatches = [{ id: "ra", name: "Notte", color: "#000000" }];
    state.fill = "url(#ra) #000000";
    state.sample = sampleOf(state.fill);
    state.contrast = { paper: "#ffffff", alpha: 1, text: false };
    panel.update(view());
    expect(line().textContent).toBe("Contrasto con la carta 21:1: basta per una forma, che chiede 3:1.");
    state.fill = "none";
    state.sample = null;
    panel.update(view());
    expect(line().hidden).toBe(true);
    expect(input("fill").hasAttribute("aria-describedby")).toBe(false);
    state.fill = null;
    panel.update(view());
    expect(line().hidden).toBe(true);
  });

  it("senza la carta non si misura", () => {
    mount();
    expect(line().hidden).toBe(true);
  });
});
describe("le scelte e i pulsanti", () => {
  it("una scelta parte quando si fa", () => {
    mount();
    const dash = field("dash").querySelector("select")!;
    dash.value = "dashed";
    dash.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toEqual(["dash=dashed"]);
  });

  it("un interruttore della vista si cambia anche in un documento che si legge soltanto", () => {
    state.editable = false;
    mount();
    const box = field("grid").querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(box.disabled).toBe(false);
    expect(field("grid").querySelector("label")!.textContent).toBe("Mostra la griglia");
    expect(box.getAttribute("aria-describedby")).toBe(field("grid").querySelector(".draw-properties-note")!.id);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toEqual(["grid=true"]);
    // Il resto si legge soltanto.
    expect(input("x").readOnly).toBe(true);
    expect(field("dash").querySelector("select")!.disabled).toBe(true);
    expect(field("ratio").querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("il lucchetto resta premuto", () => {
    mount();
    const lock = field("ratio").querySelector<HTMLButtonElement>("button")!;
    expect(lock.getAttribute("aria-label")).toBe("Mantieni le proporzioni");
    expect(lock.getAttribute("aria-pressed")).toBe("false");
    lock.click();
    expect(calls).toEqual(["ratio=true"]);
    expect(lock.getAttribute("aria-pressed")).toBe("true");
  });

  it("l'allineamento è una barra di pulsanti premuti, raggiungibile con un Tab", () => {
    mount();
    const buttons = [...field("anchor").querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["A sinistra", "Al centro", "A destra"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0]!.focus();
    press(buttons[0]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    expect(calls).toEqual([]);
    buttons[1]!.click();
    expect(calls).toEqual(["anchor=middle"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("l'enfasi è una barra di interruttori: uno misto si accende, uno acceso si spegne", () => {
    mount();
    const buttons = [...field("emphasis").querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Grassetto", "Corsivo"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["mixed", "false"]);
    expect(field("emphasis").querySelector("[role=toolbar]")!.getAttribute("aria-labelledby")).toBe(field("emphasis").querySelector(".draw-properties-label")!.id);
    buttons[0]!.click();
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    buttons[0]!.click();
    buttons[1]!.click();
    expect(calls).toEqual(["emphasis=bold:true", "emphasis=bold:false", "emphasis=italic:true"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("i comandi partono; uno che adesso non si usa resta raggiungibile e dice perché", () => {
    state.actions = {
      "align-left": { label: "Allinea a sinistra" },
      "align-center": { label: "Allinea al centro" },
      "distribute-x": { label: "Distribuisci orizzontalmente", disabled: true, note: "Servono almeno tre oggetti." },
    };
    mount();
    expect(section("arrange").hidden).toBe(false);
    expect(action("align-right").hidden).toBe(true);
    action("align-left").click();
    expect(calls).toEqual(["action align-left"]);
    const few = action("distribute-x");
    expect(few.getAttribute("aria-disabled")).toBe("true");
    expect(few.title).toBe("Distribuisci orizzontalmente — Servono almeno tre oggetti.");
    few.click();
    expect(calls).toEqual(["action align-left"]);
    expect(announced).toEqual(["Servono almeno tre oggetti."]);
    // Una barra per fila, col roving tabindex.
    const bar = action("align-left").parentElement!;
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.getAttribute("aria-label")).toBe("Allinea");
    action("align-left").focus();
    press(action("align-left"), "End");
    expect(document.activeElement).toBe(action("align-center"));
    // Il puntatore non porta via il fuoco.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    action("align-left").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("un campo a menu", () => {
  const button = (id: "tipStart" | "tipEnd" = "tipEnd"): HTMLButtonElement => field(id).querySelector<HTMLButtonElement>(".draw-properties-menu")!;
  const caption = (id: "tipStart" | "tipEnd" = "tipEnd"): string => button(id).querySelector(".draw-properties-menu-text")!.textContent!;
  const picture = (id: "tipStart" | "tipEnd" = "tipEnd"): HTMLElement => button(id).querySelector<HTMLElement>(".draw-properties-menu-picture")!;
  const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("#context-menu [role^='menuitem']")];
  const names = (): string[] => items().map((item) => item.querySelector(".menu-label")!.textContent!);
  /// Cambia le punte come farebbe l'editor, e lascia che il pannello le segua.
  const show = (end: TipLook, start: TipLook = { shape: "none", size: "medium" }): void => {
    state.tips = { start, end };
    panel.update(view());
  };

  beforeEach(() => {
    state.tips = { start: { shape: "none", size: "medium" }, end: { shape: "triangle", size: "medium" } };
  });

  afterEach(() => closeContextMenu());

  it("sta nel contorno, un pulsante per capo, dopo il tratteggio", () => {
    mount();
    expect(field("tipStart").closest<HTMLElement>(".draw-properties-section")!.dataset.section).toBe("stroke");
    expect(field("tipEnd").closest<HTMLElement>(".draw-properties-section")!.dataset.section).toBe("stroke");
    const order = [...section("stroke").querySelectorAll<HTMLElement>(".draw-properties-field")].map((each) => each.dataset.field);
    expect(order.slice(order.indexOf("dash"))).toEqual(["dash", "tipStart", "tipEnd"]);
    expect(field("tipStart").dataset.column).toBe("all");
  });

  it("è un pulsante che dice la scelta di adesso con una figura, e a chi ascolta la dice per intero", () => {
    mount();
    expect(button().tagName).toBe("BUTTON");
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(caption()).toBe("Triangolo, media");
    expect(button().getAttribute("aria-label")).toBe("Punta di fine: Triangolo, media");
    expect(button().title).toBe("Punta di fine: Triangolo, media");
    expect(caption("tipStart")).toBe("Nessuna");
    expect(button("tipStart").getAttribute("aria-label")).toBe("Punta d’inizio: Nessuna");
    // Il nome sta sopra per chi vede; a chi ascolta lo dice il pulsante, una volta.
    const name = field("tipEnd").querySelector<HTMLElement>(".draw-properties-label")!;
    expect(name.textContent).toBe("Punta di fine");
    expect(name.getAttribute("aria-hidden")).toBe("true");
    // La figura è quella della forma di quel capo, e a chi ascolta non dice niente.
    expect(picture().getAttribute("aria-hidden")).toBe("true");
    expect(picture().innerHTML).toBe(iconEl("draw-tip-triangle-end")!.outerHTML);
    expect(picture("tipStart").innerHTML).toBe(iconEl("draw-tip-none")!.outerHTML);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("segue la scelta: la figura e le parole, e «Misto» se le punte sono più d'una", () => {
    mount();
    show({ shape: "circle", size: "large" });
    expect(caption()).toBe("Cerchio, grande");
    expect(picture().innerHTML).toBe(iconEl("draw-tip-circle-end")!.outerHTML);
    show({ shape: "none", size: "large" });
    expect(caption()).toBe("Nessuna");
    expect(button().getAttribute("aria-label")).toBe("Punta di fine: Nessuna");
    show({ shape: null, size: "large" });
    expect(caption()).toBe("Misto");
    expect(button().getAttribute("aria-label")).toBe("Punta di fine: Misto");
    expect(picture().childElementCount).toBe(0);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("si apre col clic: le voci come le dà il campo, quelle di adesso segnate, e il fuoco parte dalla forma", () => {
    mount();
    button().focus();
    button().click();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    const menu = document.getElementById("context-menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe(field("tipEnd").querySelector(".draw-properties-label")!.id);
    expect(names()).toEqual(["Nessuna", "Triangolo", "Cerchio", "Piccola", "Media", "Grande", "Scambia inizio e fine"]);
    expect(items().map((item) => item.getAttribute("role"))).toEqual([...Array<string>(6).fill("menuitemradio"), "menuitem"]);
    expect(items().map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "true", "false", null]);
    // La figura accanto al nome: alle forme e allo scambio; le misure ne tengono il posto.
    expect(items().map((item) => item.querySelector(".menu-icon svg") !== null)).toEqual([true, true, true, false, false, false, true]);
    expect(items().every((item) => item.querySelector(".menu-icon") !== null)).toBe(true);
    expect(items()[1]!.querySelector(".menu-icon")!.innerHTML).toBe(iconEl("draw-tip-triangle-end")!.outerHTML);
    expect(menu.querySelectorAll("[role=separator]")).toHaveLength(2);
    expect(document.activeElement).toBe(items()[1]);
    expect(formatIssues(checkAccessibility(menu))).toBe("");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("scegliere una voce la scrive, chiude il menu e riporta il fuoco al pulsante", () => {
    mount();
    button().focus();
    button().click();
    items()[2]!.click();
    expect(calls).toEqual(["tipEnd=circle"]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
    expect(caption()).toBe("Cerchio, media");
    expect(picture().innerHTML).toBe(iconEl("draw-tip-circle-end")!.outerHTML);
    // Una misura, e lo scambio, partono col loro valore.
    button().click();
    items()[5]!.click();
    button().click();
    items()[6]!.click();
    expect(calls).toEqual(["tipEnd=circle", "tipEnd=size:large", "tipEnd=swap"]);
    expect(caption()).toBe("Cerchio, grande");
    expect(announced).toEqual([]);
  });

  it("la voce di adesso non cambia niente; una voce spenta si vede, la tastiera la salta e il clic non la sceglie", () => {
    mount();
    button().click();
    items()[1]!.click();
    expect(calls).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    // Senza una punta le misure non si scelgono.
    show({ shape: "none", size: "medium" });
    button().focus();
    button().click();
    expect(items().map((item) => item.getAttribute("aria-disabled"))).toEqual([null, null, null, "true", "true", "true", null]);
    expect(document.activeElement).toBe(items()[0]);
    items()[4]!.click();
    expect(calls).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    for (const next of [1, 2, 6]) {
      press(document.activeElement as HTMLElement, "ArrowDown");
      expect(document.activeElement).toBe(items()[next]);
    }
  });

  it("si apre anche con le frecce; Invio e Spazio sono il clic del pulsante; Esc chiude e torna al pulsante", () => {
    mount();
    button().focus();
    for (const key of ["ArrowDown", "ArrowUp"]) {
      expect(press(button(), key).defaultPrevented, key).toBe(true);
      expect(button().getAttribute("aria-expanded"), key).toBe("true");
      expect(document.activeElement, key).toBe(items()[1]);
      press(items()[1]!, "Escape");
      expect(button().getAttribute("aria-expanded"), key).toBe("false");
      expect(document.activeElement, key).toBe(button());
    }
    // L'Esc del menu è del menu: il pannello non esce.
    expect(calls).toEqual([]);
    // Con un tasto di comando le frecce non aprono, né ci si ferma sul pulsante.
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(press(button(), "ArrowDown", init).defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(button().getAttribute("aria-expanded")).toBe("false");
    }
    // Chiuso, Esc lascia il pannello, come per ogni campo che non si scrive.
    press(button(), "Escape");
    expect(calls).toEqual(["leave"]);
  });

  it("con un secondo clic sul pulsante si chiude; aprirne un altro chiude il primo", () => {
    mount();
    button().click();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    button().click();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    button().click();
    button("tipStart").click();
    expect(button("tipStart").getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("context-menu")!.getAttribute("aria-labelledby")).toBe(field("tipStart").querySelector(".draw-properties-label")!.id);
    items()[1]!.click();
    expect(calls).toEqual(["tipStart=triangle"]);
    expect(caption("tipStart")).toBe("Triangolo, media");
  });

  it("un menu rimasto aperto mentre il campo cambia sceglie com'è adesso, non com'era", () => {
    mount();
    button().click();
    const opened = items();
    // Intanto la punta è diventata un cerchio: sceglierlo non cambia niente.
    show({ shape: "circle", size: "medium" });
    opened[2]!.click();
    expect(calls).toEqual([]);
    // E senza una punta le misure non si scelgono.
    button().click();
    const sizes = items();
    show({ shape: "none", size: "medium" });
    sizes[5]!.click();
    expect(calls).toEqual([]);
    expect(caption()).toBe("Nessuna");
  });

  it("se il disegno non lo accetta, lo dice sotto il campo e a chi ascolta; una scelta riuscita lo toglie", () => {
    refusal = "Le punte non vanno a una linea chiusa.";
    mount();
    button().click();
    items()[2]!.click();
    expect(calls).toEqual(["tipEnd=circle"]);
    expect(error("tipEnd").hidden).toBe(false);
    expect(error("tipEnd").textContent).toBe(refusal);
    expect(announced).toEqual([refusal]);
    expect(button().getAttribute("aria-describedby")).toBe(error("tipEnd").id);
    expect(caption()).toBe("Triangolo, media");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    refusal = null;
    button().click();
    items()[2]!.click();
    expect(error("tipEnd").hidden).toBe(true);
    expect(button().hasAttribute("aria-describedby")).toBe(false);
    expect(caption()).toBe("Cerchio, media");
  });

  it("in un documento che si legge soltanto si vede, resta raggiungibile e non si apre", () => {
    state.editable = false;
    mount();
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(button().disabled).toBe(false);
    expect(button().getAttribute("aria-label")).toBe("Punta di fine: Triangolo, media");
    button().click();
    press(button(), "ArrowDown");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(calls).toEqual([]);
    state.editable = true;
    panel.update(view());
    expect(button().hasAttribute("aria-disabled")).toBe(false);
  });

  it("il puntatore non gli porta via il fuoco", () => {
    mount();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    picture().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("le icone che le sue voci nominano sono tutte disegnate, e sono tutte quelle delle punte", () => {
    mount();
    const wanted = ["draw-tip-none", "draw-tips-swap"];
    for (const end of ["start", "end"]) for (const shape of [...TIP_SHAPES, "other"]) wanted.push(`draw-tip-${shape}-${end}`);
    for (const name of wanted) {
      const svg = iconEl(name);
      expect(svg, name).not.toBeNull();
      expect(svg!.getAttribute("viewBox"), name).toBe("0 0 24 24");
      expect(svg!.querySelectorAll("path").length, name).toBeGreaterThan(0);
    }
    expect(iconNames().filter((name) => name.startsWith("draw-tip")).sort()).toEqual([...wanted].sort());
  });
});

describe("«Esporta la selezione»", () => {
  it("c'è se la vista lo dice, dopo le sezioni dell'oggetto, e apre la finestra sulla selezione", () => {
    mount();
    expect(section("exportSelection").hidden).toBe(true);
    panel.update({ ...view(), exportSelection: true });
    expect(section("exportSelection").hidden).toBe(false);
    expect(toggle("exportSelection").textContent).toBe("Esporta la selezione");
    const visible = [...host.querySelectorAll<HTMLElement>(".draw-properties-section")].filter((each) => !each.hidden).map((each) => each.dataset.section);
    expect(visible.indexOf("exportSelection")).toBe(visible.indexOf("text") + 1);
    const button = section("exportSelection").querySelector<HTMLButtonElement>(".draw-properties-export")!;
    expect(button.textContent).toBe("Esporta…");
    button.click();
    expect(calls).toEqual(["export selection"]);
  });
});

describe("le sezioni", () => {
  it("si chiudono e si aprono dall'intestazione, e l'editor lo sa", () => {
    mount();
    toggle("look").click();
    expect(toggle("look").getAttribute("aria-expanded")).toBe("false");
    expect(section("look").querySelector<HTMLElement>(".draw-properties-body")!.hidden).toBe(true);
    expect(calls).toEqual(["section look closed"]);
  });

  it("chiuse restano chiuse, e una si apre per prendere il fuoco", () => {
    closed = ["fill"];
    mount();
    expect(toggle("fill").getAttribute("aria-expanded")).toBe("false");
    expect(panel.focusSection("fill")).toBe(true);
    expect(toggle("fill").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field("fill").querySelector(".draw-properties-chip"));
    expect(calls).toEqual(["section fill open"]);
  });

  it("il fuoco va al primo campo, e da un campo che se ne va alla sua sezione", () => {
    mount();
    panel.focus();
    expect(document.activeElement).toBe(input("x"));
    state.only = ["y", "fill"];
    panel.update(view());
    expect(document.activeElement).toBe(toggle("place"));
  });

  it("hanno solo i campi che si sono mostrati, ciascuno al suo posto", () => {
    state.only = ["width", "fill"];
    mount();
    expect(host.querySelector('[data-field="x"]')).toBeNull();
    state.only = ["x", "y", "width", "ratio", "fill"];
    panel.update(view());
    const order = [...section("place").querySelectorAll<HTMLElement>("[data-field]")].map((line) => line.dataset.field);
    expect(order).toEqual(["x", "y", "width", "ratio"]);
    state.only = ["fill"];
    panel.update(view());
    expect(field("x").hidden).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});
describe("il testo di più righe", () => {
  it("va a capo con Invio, e parte con Ctrl e Invio o lasciandolo", () => {
    mount();
    const desc = field("desc").querySelector("textarea")!;
    write(desc, "Una casa");
    expect(press(desc, "Enter").defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    expect(press(desc, "Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(calls).toEqual(["desc=Una casa"]);
    write(desc, "Una casa\ncol tetto");
    desc.blur();
    expect(calls).toEqual(["desc=Una casa", "desc=Una casa\ncol tetto"]);
  });
});
