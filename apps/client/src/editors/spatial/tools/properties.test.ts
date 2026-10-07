// @vitest-environment happy-dom
// Il pannello delle proprietà da solo, con un editor finto che tiene i
// valori: le sezioni, i numeri che si calcolano, i colori, le scelte, i
// comandi, «Trasforma», e un disegno che cambia mentre si scrive.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import {
  createProperties,
  type ActionState,
  type FieldId,
  type FieldState,
  type NumberState,
  type Properties,
  type PropertiesView,
  type SectionId,
  type TransformId,
} from "./properties";
import { lengthUnits, PERCENT_UNITS } from "./quantity";
import type { PaintSample } from "./resources";

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
  dash: string | null;
  anchor: string | null;
  bold: boolean | null;
  italic: boolean | null;
  ratio: boolean;
  grid: boolean;
  desc: string;
  /// Il nome di una tavola, che c'è se non è `null`.
  name: string | null;
  actions: Partial<Record<string, ActionState>>;
  transform: boolean;
  only: FieldId[] | null;
};

const length = (value: number | null, label: string): NumberState => ({
  kind: "number",
  label,
  value,
  unit: "mm",
  units: lengthUnits("mm"),
  relative: true,
  places: 3,
});

function view(): PropertiesView {
  const fields: Partial<Record<FieldId, FieldState>> = {
    x: length(state.x, "X"),
    y: length(state.y, "Y"),
    width: { ...length(state.width, "Larghezza"), min: 0.01 },
    ratio: { kind: "press", label: "Mantieni le proporzioni", on: state.ratio },
    opacity: { kind: "number", label: "Opacità", value: state.opacity, unit: "%", units: PERCENT_UNITS, relative: false, places: 0, min: 0, max: 100 },
    fill: { kind: "paint", label: "Riempimento", value: state.fill, ...(state.sample === null ? {} : { sample: state.sample }) },
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
  if (state.name !== null) fields.boardName = { kind: "line", label: "Nome", value: state.name, max: 20 };
  if (state.transform) {
    const draft = (label: string, value: number, unit: string): NumberState => ({ kind: "number", label, value, unit, units: { [unit]: 1 }, relative: false, places: 2 });
    Object.assign(fields, {
      turn: draft("Ruota di", 0, "°"),
      scaleX: draft("Scala in larghezza", 100, "%"),
      scaleY: draft("Scala in altezza", 100, "%"),
      skewX: draft("Inclina in orizzontale", 0, "°"),
      skewY: draft("Inclina in verticale", 0, "°"),
    });
  }
  const shown = state.only === null ? fields : Object.fromEntries(state.only.map((id) => [id, fields[id]]));
  return { key: state.key, subject: "Rettangolo", editable: state.editable, fields: shown, actions: state.actions, attributes: false };
}

/// Un cambio come l'editor lo scrive: il valore, e il pannello che lo segue.
function change(id: FieldId, value: number | string | boolean): string | null {
  calls.push(`${id}=${String(value)}`);
  if (refusal !== null) return refusal;
  if (id === "x") state.x = value as number;
  else if (id === "width") state.width = value as number;
  else if (id === "opacity") state.opacity = value as number;
  else if (id === "fill") state.fill = value as string;
  else if (id === "dash") state.dash = value as string;
  else if (id === "anchor") state.anchor = value as string;
  else if (id === "emphasis") {
    const [which, on] = (value as string).split(":");
    state[which as "bold" | "italic"] = on === "true";
  }
  else if (id === "ratio") state.ratio = value as boolean;
  else if (id === "grid") state.grid = value as boolean;
  else if (id === "desc") state.desc = value as string;
  else if (id === "boardName") state.name = value as string;
  panel.update(view());
  return null;
}

function mount(): Properties {
  panel = createProperties(life, {
    closed,
    onChange: change,
    onAction: (id) => calls.push(`action ${id}`),
    onTransform: (values: Readonly<Record<TransformId, number>>) => {
      calls.push(`transform ${values.turn} ${values.scaleX} ${values.scaleY} ${values.skewX} ${values.skewY}`);
      return refusal;
    },
    onSection: (id, open) => calls.push(`section ${id} ${open ? "open" : "closed"}`),
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
    dash: "solid",
    anchor: "start",
    bold: null,
    italic: false,
    ratio: false,
    grid: false,
    desc: "",
    name: null,
    actions: {},
    transform: false,
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
    expect(visible).toEqual(["place", "look", "text", "document", "view"]);
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
    expect(frame.dataset.shape).toBe("square");
    write(fill, "red");
    // Il campione segue ciò che si scrive.
    expect(frame.dataset.shape).toBe("ring");
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
    expect(frame.dataset.shape).toBe("ring");
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

  it("si scelgono anche col selettore del sistema, in un passo alla fine", () => {
    mount();
    const picker = field("fill").querySelector<HTMLInputElement>(".draw-properties-picker")!;
    expect(picker.value).toBe("#0072b2");
    expect(picker.getAttribute("aria-label")).toBe("Riempimento: selettore del sistema");
    picker.value = "#009e73";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input("fill").value).toBe("#009e73");
    expect(calls).toEqual([]);
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    expect(calls).toEqual(["fill=#009e73"]);
  });

  it("hanno i campioni della tavolozza in un menu", () => {
    mount();
    const chip = field("fill").querySelector<HTMLButtonElement>(".draw-properties-chip")!;
    expect(chip.getAttribute("aria-label")).toBe("Riempimento: campioni");
    expect(chip.getAttribute("aria-haspopup")).toBe("menu");
    chip.click();
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const items = [...document.querySelectorAll<HTMLElement>("#context-menu [role^='menuitem']")];
    expect(items.map((item) => item.querySelector(".menu-label")!.textContent)).toEqual(["Nessuno", "Nero", "Blu", "Vermiglio", "Verde", "Porpora", "Arancione", "Azzurro", "Giallo"]);
    expect(items[2]!.getAttribute("aria-checked")).toBe("true");
    items[4]!.click();
    expect(calls).toEqual(["fill=#009e73"]);
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

describe("«Trasforma»", () => {
  it("dice di quanto, e applica con Invio o col pulsante", () => {
    state.transform = true;
    mount();
    expect(input("scaleX").value).toBe("100");
    write(input("turn"), "15");
    write(input("scaleX"), "50*3");
    // Lasciare il campo non applica niente.
    input("scaleX").blur();
    expect(calls).toEqual([]);
    press(input("scaleX"), "Enter");
    expect(calls).toEqual(["transform 15 150 100 0 0"]);
    // I valori restano, per un'altra selezione; le frecce li cambiano senza
    // applicare.
    state.key = "obbbbbbbb";
    panel.update(view());
    expect(input("turn").value).toBe("15");
    press(input("turn"), "ArrowUp");
    expect(input("turn").value).toBe("16");
    host.querySelector<HTMLButtonElement>(".draw-properties-apply")!.click();
    expect(calls).toEqual(["transform 15 150 100 0 0", "transform 16 150 100 0 0"]);
  });

  it("non applica un valore che non si legge, e lo segna", () => {
    state.transform = true;
    mount();
    write(input("skewY"), "10mm");
    host.querySelector<HTMLButtonElement>(".draw-properties-apply")!.click();
    expect(calls).toEqual([]);
    expect(error("skewY").hidden).toBe(false);
    expect(document.activeElement).toBe(input("skewY"));
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
    closed = ["look"];
    mount();
    expect(toggle("look").getAttribute("aria-expanded")).toBe("false");
    expect(panel.focusSection("look")).toBe(true);
    expect(toggle("look").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field("fill").querySelector(".draw-properties-chip"));
    expect(calls).toEqual(["section look open"]);
    expect(panel.focusSection("transform")).toBe(false);
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

describe("il testo di una riga", () => {
  it("parte con Invio o lasciandolo, torna com'era con Esc, e non passa la sua misura", () => {
    state.name = "Copertina";
    mount();
    expect(section("board").hidden).toBe(false);
    const name = input("boardName");
    expect([name.tagName, name.type, name.value, name.maxLength]).toEqual(["INPUT", "text", "Copertina", 20]);
    write(name, "Retro");
    expect(press(name, "Enter").defaultPrevented).toBe(true);
    expect(calls).toEqual(["boardName=Retro"]);
    write(name, "Fronte");
    press(name, "Escape");
    expect(name.value).toBe("Retro");
    write(name, "Fronte");
    name.blur();
    expect(calls).toEqual(["boardName=Retro", "boardName=Fronte"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("in un documento che si legge soltanto non si scrive", () => {
    state.name = "Copertina";
    state.editable = false;
    mount();
    expect(input("boardName").readOnly).toBe(true);
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
