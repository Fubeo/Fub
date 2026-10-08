// @vitest-environment happy-dom
// La sezione «Effetti», da sola, su un editor finto che cambia come gli si
// chiede: l'elenco coi suoi comandi e nomi, i campi di ogni genere con i
// loro errori, i tasti, il menu che aggiunge con le sue voci spente, gli
// effetti diversi e il filtro d'altri, i rifiuti, il fuoco che resta, la
// sola lettura e la lingua; e, su un documento vero, la vista che l'editor
// le dà.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { doc } from "../scene/test-support";
import type { LengthUnit } from "../scene/rulers";
import type { DrawKey } from "../strings";
import { createEffectsPanel, effectsView, type EffectsBody, type EffectsPanel, type EffectsPanelView } from "./effects-panel";
import { NewIds } from "./edit";
import { defaultEffect, effectsOps, MAX_EFFECTS, type Effect, type EffectsChange, type Glow, type Shadow } from "./effects";
import { estimate } from "./measure";
import { fromUnit } from "./rulers";
import { LAYER, open, type Opened } from "./test-support";
import { applied, DEFS } from "./tip-support";

const SHADOW: Shadow = { kind: "shadow", dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };
const GLOW: Glow = { kind: "glow", size: 8, color: "#ffd400", opacity: 0.75, hidden: false };
const BLUR: Effect = { kind: "blur", radius: 4, hidden: false };
const INNER: Effect = defaultEffect("inner-shadow");

const READ_ONLY = "Modifica non applicata: il disegno è in sola lettura.";

function viewOf(body: EffectsBody, more: Partial<EffectsPanelView> = {}): EffectsPanelView {
  return {
    key: "oa",
    count: 1,
    body,
    refusal: null,
    full: false,
    blurred: body.kind === "list" && body.effects.some((effect) => effect.kind === "blur"),
    unit: "px",
    swatches: [{ name: "Blu marca", color: "#0072b2" }],
    ...more,
  };
}

const listOf = (...effects: Effect[]): EffectsBody => ({ kind: "list", effects });

interface Sent {
  readonly change: EffectsChange;
  readonly label: DrawKey;
}

let host: HTMLElement;
let life: Lifetime;
let panel: EffectsPanel;
let state: { view: EffectsPanelView; editable: boolean };
let sent: Sent[];
let announced: string[];
let revealed: number;
/// Ciò che l'editor risponde a un cambio: `null` se lo fa.
let refusal: string | null;
/// Un editor che, a ogni cambio, dà alla selezione un'altra chiave, come
/// quando un oggetto riceve il suo id.
let rekey: boolean;

const update = (): void => panel.update(state.view, state.editable);

/// La vista dopo `change`, come la darebbe l'editor.
function changed(view: EffectsPanelView, change: EffectsChange): EffectsPanelView {
  const current = view.body.kind === "list" ? view.body.effects : [];
  let effects: readonly Effect[];
  if (change.kind === "clear") effects = [];
  else if (change.kind === "set") effects = change.effects;
  else effects = [...current, change.effect];
  const body: EffectsBody = effects.length === 0 ? { kind: "none" } : { kind: "list", effects };
  return { ...view, key: rekey ? `${view.key}+` : view.key, body, full: effects.length >= MAX_EFFECTS, blurred: effects.some((effect) => effect.kind === "blur") };
}

/// La sezione su un editor finto, con l'intestazione in cui sta il pulsante
/// che aggiunge.
function mount(view: EffectsPanelView = viewOf(listOf(SHADOW, BLUR)), editable = true): EffectsPanel {
  state = { view, editable };
  panel = createEffectsPanel(life, {
    onChange: (change, label) => {
      sent.push({ change, label });
      if (refusal !== null) return refusal;
      state.view = changed(state.view, change);
      update();
      return null;
    },
    reveal: () => {
      revealed += 1;
    },
    announce: (text) => announced.push(text),
  });
  const heading = document.createElement("h3");
  heading.append(panel.add);
  host.append(heading, panel.element);
  update();
  return panel;
}

const one = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".draw-effect")];
const shows = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-effect-show")];
const names = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-effect-name")];
const removes = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-effect-remove")];
const openRows = (): number[] => names().flatMap((name, at) => (name.getAttribute("aria-expanded") === "true" ? [at] : []));
const fieldsOf = (row: number): HTMLElement => rows()[row]!.querySelector<HTMLElement>(".draw-effect-fields")!;
const inputsOf = (row: number): HTMLInputElement[] => [...fieldsOf(row).querySelectorAll<HTMLInputElement>('input[type="text"]')];
/// Il campo `label` della riga `row`.
const input = (row: number, label: string): HTMLInputElement =>
  inputsOf(row).find((each) => document.querySelector(`label[for="${each.id}"]`)!.firstElementChild!.textContent === label)!;
const labelsOf = (row: number): string[] => [...fieldsOf(row).querySelectorAll("label")].map((each) => each.firstElementChild!.textContent!);
const errorOf = (row: number): HTMLElement => fieldsOf(row).querySelector<HTMLElement>(".draw-properties-error")!;
const pickerOf = (row: number): HTMLInputElement => fieldsOf(row).querySelector<HTMLInputElement>('input[type="color"]')!;
const state_ = (): HTMLElement => one(".draw-effects-state");
const note = (): HTMLElement => one(".draw-effects > .draw-properties-note");
const list = (): HTMLElement => one(".draw-effects-list");
const actionButtons = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-effects-actions > button")];
const [useButton, clearButton] = [0, 1].map((at) => (): HTMLButtonElement => actionButtons()[at]!);
const lastSent = (): Sent => sent[sent.length - 1]!;
/// L'effetto `at` dell'ultimo cambio mandato.
const effectSent = (at = 0): Effect => {
  const change = lastSent().change;
  if (change.kind !== "set") throw new Error("non è un cambio di elenco");
  return change.effects[at]!;
};

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
const entries = (): HTMLButtonElement[] => [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const entry = (label: string): HTMLButtonElement => entries().find((each) => each.querySelector(".menu-label")!.textContent === label)!;
const reason = (label: string): string => entry(label).querySelector(".menu-description")?.textContent ?? "";

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  sent = [];
  announced = [];
  revealed = 0;
  refusal = null;
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

describe("l'elenco", () => {
  it("è un elenco con una riga per effetto, coi tre comandi e il riassunto, nell'ordine di disegno", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR)));
    expect(list().getAttribute("role")).toBe("list");
    expect(list().getAttribute("aria-label")).toBe("Effetti");
    expect(list().hidden).toBe(false);
    expect(rows().map((row) => row.getAttribute("role"))).toEqual(["listitem", "listitem", "listitem"]);
    expect(rows().map((row) => row.querySelector(".draw-effect-title")!.textContent)).toEqual(["Ombra esterna", "Bagliore esterno", "Sfocatura"]);
    expect(rows().map((row) => row.querySelector(".draw-effect-summary")!.textContent)).toEqual(["0, 4 · 8 · 25%", "8 · 75%", "4"]);
    expect(rows().map((row) => row.dataset.kind)).toEqual(["shadow", "glow", "blur"]);
    // L'occhio è un pulsante premuto se l'effetto si vede, col nome che non cambia.
    expect(shows().map((button) => [button.getAttribute("aria-pressed"), button.getAttribute("aria-label")])).toEqual([
      ["true", "Mostra Ombra esterna"],
      ["true", "Mostra Bagliore esterno"],
      ["true", "Mostra Sfocatura"],
    ]);
    expect(removes().map((button) => button.getAttribute("aria-label"))).toEqual(["Togli Ombra esterna", "Togli Bagliore esterno", "Togli Sfocatura"]);
    // Il nome apre e chiude i campi, che sono suoi, e dice a voce i valori.
    expect(names().map((button) => button.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(names().map((button) => document.getElementById(button.getAttribute("aria-controls")!)).map((fields) => fields?.hidden)).toEqual([true, true, true]);
    expect(names()[0]!.querySelector(".sr-only")!.textContent).toBe(", X 0, Y 4, sfocatura 8, opacità 25%");
    expect(names()[0]!.querySelector(".draw-effect-summary")!.getAttribute("aria-hidden")).toBe("true");
    expect(names()[1]!.querySelector(".sr-only")!.textContent).toBe(", dimensione 8, opacità 75%");
    expect(names()[2]!.querySelector(".sr-only")!.textContent).toBe(", raggio 4");
    // Il campione ha il colore dell'effetto; la sfocatura non ne ha.
    expect(rows().map((row) => row.querySelector<HTMLElement>(".draw-effect-chip")!.hidden)).toEqual([false, false, true]);
    expect(rows()[0]!.querySelector<HTMLElement>(".draw-effect-chip")!.style.getPropertyValue("--effect-color")).toBe("#000000");
    expect(rows()[1]!.querySelector<HTMLElement>(".draw-effect-chip")!.style.getPropertyValue("--effect-color")).toBe("#ffd400");
    expect(state_().hidden).toBe(true);
    expect(note().hidden).toBe(true);
    expect(one(".draw-effects-actions").hidden).toBe(true);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("«Aggiungi effetto» sta in intestazione e apre un menu", () => {
    mount();
    expect(panel.add.getAttribute("aria-label")).toBe("Aggiungi effetto");
    expect(panel.add.getAttribute("aria-haspopup")).toBe("menu");
    expect(panel.add.getAttribute("aria-expanded")).toBe("false");
    expect(panel.add.getAttribute("aria-disabled")).toBeNull();
    expect(panel.add.querySelector("svg")).not.toBeNull();
    expect(panel.element.contains(panel.add)).toBe(false);
  });

  it("senza effetti dice come si aggiungono, e l'elenco non c'è", () => {
    mount(viewOf({ kind: "none" }));
    expect(list().hidden).toBe(true);
    expect(rows()).toEqual([]);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toBe("Nessun effetto: aggiungi un’ombra, un bagliore o una sfocatura.");
    expect(state_().hidden).toBe(true);
    expect(one(".draw-effects-actions").hidden).toBe(true);
    expect(panel.add.getAttribute("aria-disabled")).toBeNull();
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un effetto nascosto ha l'occhio non premuto, un'altra figura e il suggerimento «Mostra»", () => {
    mount(viewOf(listOf({ ...SHADOW, hidden: true }, BLUR)));
    const [first, second] = shows();
    expect(first!.getAttribute("aria-pressed")).toBe("false");
    expect(first!.title).toBe("Mostra Ombra esterna");
    expect(second!.getAttribute("aria-pressed")).toBe("true");
    expect(second!.title).toBe("Nascondi Sfocatura");
    expect(rows()[0]!.hasAttribute("data-hidden")).toBe(true);
    expect(rows()[1]!.hasAttribute("data-hidden")).toBe(false);
    // Le figure dell'occhio sono diverse: non è il solo colore a dirlo.
    expect(first!.innerHTML).not.toBe(second!.innerHTML);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("la riga aperta", () => {
  it("una sola è aperta alla volta, e il nome la apre e la chiude", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR)));
    expect(openRows()).toEqual([]);
    click(names()[0]!);
    expect(openRows()).toEqual([0]);
    expect(fieldsOf(0).hidden).toBe(false);
    expect(rows()[0]!.hasAttribute("data-open")).toBe(true);
    expect(names()[0]!.querySelector<HTMLElement>(".draw-effect-summary")!.hidden).toBe(true);
    click(names()[2]!);
    expect(openRows()).toEqual([2]);
    expect(fieldsOf(0).hidden).toBe(true);
    expect(rows()[0]!.hasAttribute("data-open")).toBe(false);
    click(names()[2]!);
    expect(openRows()).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("resta aperta finché la selezione è la stessa, anche quando i valori cambiano", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    click(names()[1]!);
    state.view = viewOf(listOf(SHADOW, { ...BLUR, radius: 6 }));
    update();
    expect(openRows()).toEqual([1]);
    expect(input(1, "Raggio").value).toBe("6");
    // Un'altra selezione la chiude.
    state.view = viewOf(listOf(SHADOW, BLUR), { key: "ob" });
    update();
    expect(openRows()).toEqual([]);
  });

  it("resta aperta anche se un cambio dà un'altra chiave alla selezione", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    rekey = true;
    click(names()[0]!);
    enter(input(0, "Y"), "7");
    expect(lastSent().label).toBe("draw.effects.kind.shadow");
    expect(openRows()).toEqual([0]);
    // Ma una selezione che cambia da sé la chiude.
    state.view = { ...state.view, key: "altro" };
    update();
    expect(openRows()).toEqual([]);
  });

  it("i campi dipendono dal genere, coi nomi e le unità che si sentono", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR, INNER)));
    for (const at of [0, 1, 2, 3]) click(names()[at]!);
    click(names()[0]!);
    expect(labelsOf(0)).toEqual(["X", "Y", "Sfocatura", "Opacità", "Colore"]);
    expect(fieldsOf(0).querySelector("label")!.textContent).toBe("X (px)");
    expect(fieldsOf(0).getAttribute("role")).toBe("group");
    expect(fieldsOf(0).getAttribute("aria-label")).toBe("Ombra esterna: valori");
    expect(inputsOf(0).map((each) => each.value)).toEqual(["0", "4", "8", "25", "#000000"]);
    expect(pickerOf(0).value).toBe("#000000");
    expect(pickerOf(0).getAttribute("aria-label")).toBe("Colore: selettore del sistema");
    click(names()[1]!);
    expect(labelsOf(1)).toEqual(["Dimensione", "Opacità", "Colore"]);
    expect(inputsOf(1).map((each) => each.value)).toEqual(["8", "75", "#ffd400"]);
    click(names()[2]!);
    expect(labelsOf(2)).toEqual(["Raggio"]);
    expect(inputsOf(2).map((each) => each.value)).toEqual(["4"]);
    expect(pickerOf(2)).toBeNull();
    click(names()[3]!);
    expect(labelsOf(3)).toEqual(["X", "Y", "Sfocatura", "Opacità", "Colore"]);
    expect(fieldsOf(3).getAttribute("aria-label")).toBe("Ombra interna: valori");
    // I numeri sono cursori con i loro limiti; il colore è un campo di testo.
    click(names()[0]!);
    expect(inputsOf(0).map((each) => each.getAttribute("role"))).toEqual(["spinbutton", "spinbutton", "spinbutton", "spinbutton", null]);
    expect(input(0, "Y").getAttribute("aria-valuenow")).toBe("4");
    expect(input(0, "Y").getAttribute("aria-valuetext")).toBe("4 px");
    expect(input(0, "Y").getAttribute("aria-valuemin")).toBe("-2000");
    expect(input(0, "Y").getAttribute("aria-valuemax")).toBe("2000");
    expect(input(0, "Opacità").getAttribute("aria-valuemax")).toBe("100");
    expect(input(0, "Sfocatura").getAttribute("aria-valuemin")).toBe("0");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("le lunghezze sono nell'unità del disegno", () => {
    mount(viewOf(listOf({ ...SHADOW, dx: 4, dy: 8, blur: 12 }), { unit: "pt" as LengthUnit }));
    click(names()[0]!);
    expect(inputsOf(0).map((each) => each.value).slice(0, 3)).toEqual(["3", "6", "9"]);
    expect(fieldsOf(0).querySelector("label")!.textContent).toBe("X (pt)");
    expect(names()[0]!.querySelector(".draw-effect-summary")!.textContent).toBe("3, 6 · 9 · 25%");
    // Scritta in pt, la lunghezza va in unità della scena.
    enter(input(0, "Y"), "12");
    expect((effectSent() as Shadow).dy).toBe(fromUnit(12, "pt"));
    expect((effectSent() as Shadow).dy).toBe(16);
    // Si dice anche l'unità: 1 in sono 72 pt.
    enter(input(0, "X"), "1in");
    expect((effectSent() as Shadow).dx).toBe(96);
  });
});

describe("i campi", () => {
  it("Invio scrive il valore, con il nome dell'effetto nella cronologia", () => {
    mount();
    click(names()[0]!);
    enter(input(0, "X"), "6");
    expect(sent).toHaveLength(1);
    expect(lastSent().label).toBe("draw.effects.kind.shadow");
    expect(lastSent().change).toEqual({ kind: "set", effects: [{ ...SHADOW, dx: 6 }, BLUR] });
    expect(input(0, "X").value).toBe("6");
    expect(document.activeElement).toBe(input(0, "X"));
    expect(errorOf(0).hidden).toBe(true);
    // La sfocatura ha il suo nome.
    click(names()[1]!);
    enter(input(1, "Raggio"), "10");
    expect(lastSent().label).toBe("draw.effects.kind.blur");
    expect(effectSent(1)).toEqual({ ...BLUR, radius: 10 });
  });

  it("calcola le espressioni e segue le unità e le percentuali", () => {
    mount();
    click(names()[0]!);
    enter(input(0, "Sfocatura"), "2*5");
    expect((effectSent() as Shadow).blur).toBe(10);
    enter(input(0, "Opacità"), "50%");
    expect((effectSent() as Shadow).opacity).toBe(0.5);
    enter(input(0, "Opacità"), "100/3");
    expect((effectSent() as Shadow).opacity).toBe(0.3333);
    // Una percentuale di una lunghezza è del valore di adesso.
    enter(input(0, "Y"), "150%");
    expect((effectSent() as Shadow).dy).toBe(6);
  });

  it("tiene i valori nei limiti, e un valore uguale non scrive niente", () => {
    mount();
    click(names()[0]!);
    enter(input(0, "Opacità"), "150");
    expect((effectSent() as Shadow).opacity).toBe(1);
    enter(input(0, "Sfocatura"), "-5");
    expect((effectSent() as Shadow).blur).toBe(0);
    enter(input(0, "X"), "99999");
    expect((effectSent() as Shadow).dx).toBe(2000);
    const count = sent.length;
    enter(input(0, "Y"), "4");
    expect(sent).toHaveLength(count);
    expect(input(0, "Y").value).toBe("4");
  });

  it("su e giù cambiano di 1, con Maiusc di 10, e partono subito", () => {
    mount();
    click(names()[0]!);
    input(0, "Y").focus();
    const up = key("ArrowUp");
    expect(up.defaultPrevented).toBe(true);
    expect((effectSent() as Shadow).dy).toBe(5);
    key("ArrowUp", { shiftKey: true });
    expect((effectSent() as Shadow).dy).toBe(15);
    key("ArrowDown");
    expect((effectSent() as Shadow).dy).toBe(14);
    key("ArrowDown", { shiftKey: true });
    expect((effectSent() as Shadow).dy).toBe(4);
    expect(input(0, "Y").value).toBe("4");
    // I passi di seguito hanno lo stesso nome, e la cronologia li unisce.
    expect(sent.map((each) => each.label)).toEqual(["draw.effects.kind.shadow", "draw.effects.kind.shadow", "draw.effects.kind.shadow", "draw.effects.kind.shadow"]);
    // L'opacità va per punti percentuali, e si ferma al limite.
    input(0, "Opacità").focus();
    key("ArrowUp", { shiftKey: true });
    expect((effectSent() as Shadow).opacity).toBe(0.35);
    for (let step = 0; step < 7; step += 1) key("ArrowUp", { shiftKey: true });
    expect((effectSent() as Shadow).opacity).toBe(1);
    const count = sent.length;
    key("ArrowUp");
    expect(sent).toHaveLength(count);
    // La sfocatura non scende sotto zero.
    input(0, "Sfocatura").focus();
    key("ArrowDown", { shiftKey: true });
    expect((effectSent() as Shadow).blur).toBe(0);
  });

  it("su e giù partono dal valore scritto a metà", () => {
    mount();
    click(names()[0]!);
    type(input(0, "X"), "20");
    key("ArrowUp");
    expect((effectSent() as Shadow).dx).toBe(21);
    expect(input(0, "X").value).toBe("21");
  });

  it("Esc riporta com'era e, di nuovo, lascia il tasto al foglio", () => {
    mount();
    click(names()[0]!);
    type(input(0, "X"), "9");
    const first = key("Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(input(0, "X").value).toBe("0");
    expect(sent).toEqual([]);
    const second = key("Escape");
    expect(second.defaultPrevented).toBe(false);
    // Con un errore scritto, Esc lo toglie.
    enter(input(0, "X"), "abc");
    expect(errorOf(0).hidden).toBe(false);
    key("Escape");
    expect(errorOf(0).hidden).toBe(true);
    expect(input(0, "X").hasAttribute("aria-invalid")).toBe(false);
    expect(input(0, "X").value).toBe("0");
  });

  it("un valore che non va resta scritto, segnato, col messaggio accanto, e a voce", () => {
    mount();
    click(names()[0]!);
    enter(input(0, "X"), "abc");
    expect(sent).toEqual([]);
    expect(input(0, "X").value).toBe("abc");
    expect(input(0, "X").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(0).hidden).toBe(false);
    expect(errorOf(0).textContent).not.toBe("");
    expect(input(0, "X").getAttribute("aria-describedby")).toBe(errorOf(0).id);
    expect(announced).toEqual([errorOf(0).textContent]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    // Un campo vuoto non va, e l'errore passa al campo nuovo.
    enter(input(0, "Y"), "");
    expect(input(0, "X").hasAttribute("aria-invalid")).toBe(false);
    expect(input(0, "Y").getAttribute("aria-invalid")).toBe("true");
    // Corretto, l'errore se ne va.
    enter(input(0, "Y"), "3");
    expect(input(0, "Y").hasAttribute("aria-invalid")).toBe(false);
    expect(errorOf(0).hidden).toBe(true);
    expect((effectSent() as Shadow).dy).toBe(3);
    // Una percentuale non prende un'unità di lunghezza.
    enter(input(0, "Opacità"), "3mm");
    expect(input(0, "Opacità").getAttribute("aria-invalid")).toBe("true");
  });

  it("lasciare il campo scrive, senza parlare se il valore non va", () => {
    mount();
    click(names()[0]!);
    type(input(0, "X"), "11");
    input(0, "Y").focus();
    expect((effectSent() as Shadow).dx).toBe(11);
    announced.length = 0;
    type(input(0, "Y"), "zzz");
    input(0, "X").focus();
    expect(input(0, "Y").getAttribute("aria-invalid")).toBe("true");
    expect(announced).toEqual([]);
  });

  it("se l'editor rifiuta il valore, il campo resta com'era scritto e dice perché", () => {
    mount();
    click(names()[0]!);
    refusal = "Non si può.";
    enter(input(0, "X"), "6");
    expect(sent).toHaveLength(1);
    expect(input(0, "X").value).toBe("6");
    expect(input(0, "X").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(0).textContent).toBe("Non si può.");
    expect(announced).toEqual(["Non si può."]);
    expect(openRows()).toEqual([0]);
    // Il valore del disegno non è cambiato.
    expect(state.view.body.kind === "list" ? state.view.body.effects[0] : null).toEqual(SHADOW);
  });

  it("il colore è un codice, un nome o il nome di un campione, e si copia", () => {
    mount();
    click(names()[0]!);
    enter(input(0, "Colore"), "#FF0000");
    expect((effectSent() as Shadow).color).toBe("#ff0000");
    enter(input(0, "Colore"), "red");
    expect((effectSent() as Shadow).color).toBe("#ff0000");
    enter(input(0, "Colore"), "00ff00");
    expect((effectSent() as Shadow).color).toBe("#00ff00");
    enter(input(0, "Colore"), "blu MARCA");
    expect((effectSent() as Shadow).color).toBe("#0072b2");
    // Il campo dice il codice che si è copiato, non il nome del campione.
    expect(input(0, "Colore").value).toBe("#0072b2");
    expect(pickerOf(0).value).toBe("#0072b2");
    expect(rows()[0]!.querySelector<HTMLElement>(".draw-effect-chip")!.style.getPropertyValue("--effect-color")).toBe("#0072b2");
    const count = sent.length;
    enter(input(0, "Colore"), "non è un colore");
    expect(sent).toHaveLength(count);
    expect(input(0, "Colore").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(0).textContent).toBe("Scrivi un colore: un codice come #0072b2, un nome come red, o il nome di un campione del documento.");
  });

  it("il selettore del sistema mostra il colore mentre lo si muove e lo scrive quando lo si sceglie", () => {
    mount();
    click(names()[0]!);
    const picker = pickerOf(0);
    picker.value = "#102030";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input(0, "Colore").value).toBe("#102030");
    expect(sent).toEqual([]);
    expect(rows()[0]!.querySelector<HTMLElement>(".draw-effect-chip")!.style.getPropertyValue("--effect-color")).toBe("#102030");
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    expect((effectSent() as Shadow).color).toBe("#102030");
    // Chiuso senza scegliere, il campo torna al disegno.
    picker.value = "#445566";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input(0, "Colore").value).toBe("#445566");
    input(0, "X").focus();
    expect(input(0, "Colore").value).toBe("#102030");
  });
});

describe("l'occhio, il nome e il pulsante che toglie", () => {
  it("l'occhio nasconde e mostra, col nome del passo e a voce", () => {
    mount();
    click(shows()[0]!);
    expect(lastSent().label).toBe("draw.action.effect_hide.shadow");
    expect(lastSent().change).toEqual({ kind: "set", effects: [{ ...SHADOW, hidden: true }, BLUR] });
    expect(announced).toEqual(["Nascosto: Ombra esterna."]);
    expect(shows()[0]!.getAttribute("aria-pressed")).toBe("false");
    click(shows()[0]!);
    expect(lastSent().label).toBe("draw.action.effect_show.shadow");
    expect(lastSent().change).toEqual({ kind: "set", effects: [SHADOW, BLUR] });
    expect(announced).toEqual(["Nascosto: Ombra esterna.", "Mostrato: Ombra esterna."]);
    click(shows()[1]!);
    expect(lastSent().label).toBe("draw.action.effect_hide.blur");
  });

  it("il pulsante toglie l'effetto e il fuoco va alla riga che prende il suo posto", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR)));
    removes()[1]!.focus();
    click(removes()[1]!);
    expect(lastSent().label).toBe("draw.action.effect_remove.glow");
    expect(lastSent().change).toEqual({ kind: "set", effects: [SHADOW, BLUR] });
    expect(announced).toEqual(["Tolto: Bagliore esterno."]);
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(names()[1]);
    // L'ultima: il fuoco va alla precedente.
    removes()[1]!.focus();
    click(removes()[1]!);
    expect(document.activeElement).toBe(names()[0]);
    // L'unica: va a «Aggiungi effetto».
    removes()[0]!.focus();
    click(removes()[0]!);
    expect(lastSent().change).toEqual({ kind: "set", effects: [] });
    expect(rows()).toEqual([]);
    expect(list().hidden).toBe(true);
    expect(document.activeElement).toBe(panel.add);
    expect(note().textContent).toContain("Nessun effetto");
  });

  it("togliere un effetto col puntatore non sposta il fuoco", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    const outside = document.createElement("button");
    host.append(outside);
    outside.focus();
    click(removes()[0]!);
    expect(document.activeElement).toBe(outside);
  });

  it("la riga aperta segue l'effetto quando uno sopra viene tolto", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR)));
    click(names()[2]!);
    click(removes()[0]!);
    expect(openRows()).toEqual([1]);
    expect(labelsOf(1)).toEqual(["Raggio"]);
    // Se è l'aperta a essere tolta, nessuna resta aperta.
    click(removes()[1]!);
    expect(openRows()).toEqual([]);
  });

  it("Canc toglie l'effetto dell'intestazione in cui si è", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    names()[0]!.focus();
    const event = key("Delete");
    expect(event.defaultPrevented).toBe(true);
    expect(lastSent().label).toBe("draw.action.effect_remove.shadow");
    expect(rows()).toHaveLength(1);
    names()[0]!.focus();
    key("Backspace");
    expect(rows()).toEqual([]);
  });

  it("le frecce passano da un nome all'altro, e Home e Fine agli estremi", () => {
    mount(viewOf(listOf(SHADOW, GLOW, BLUR)));
    names()[0]!.focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(names()[1]);
    key("ArrowDown");
    key("ArrowDown");
    expect(document.activeElement).toBe(names()[2]);
    key("ArrowUp");
    expect(document.activeElement).toBe(names()[1]);
    key("Home");
    expect(document.activeElement).toBe(names()[0]);
    key("End");
    expect(document.activeElement).toBe(names()[2]);
    // Il tasto non arriva al foglio.
    const event = key("ArrowUp");
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("il menu «Aggiungi effetto»", () => {
  it("ha i cinque generi nell'ordine, e ciascuno aggiunge il suo effetto", () => {
    mount(viewOf({ kind: "none" }));
    click(panel.add);
    expect(panel.add.getAttribute("aria-expanded")).toBe("true");
    expect(menu().getAttribute("role")).toBe("menu");
    expect(entries().map((each) => each.querySelector(".menu-label")!.textContent)).toEqual(["Ombra esterna", "Ombra interna", "Bagliore esterno", "Bagliore interno", "Sfocatura"]);
    expect(entries().map((each) => each.getAttribute("aria-disabled"))).toEqual([null, null, null, null, null]);
    expect(formatIssues(checkAccessibility(menu()))).toBe("");
    click(entry("Ombra esterna"));
    expect(sent).toHaveLength(1);
    expect(lastSent().label).toBe("draw.action.effect_add.shadow");
    expect(lastSent().change).toEqual({ kind: "add", effect: defaultEffect("shadow") });
    expect(announced).toEqual(["Aggiunto: Ombra esterna."]);
    expect(revealed).toBe(1);
    expect(panel.add.getAttribute("aria-expanded")).toBe("false");
    // Il nuovo effetto si apre.
    expect(rows()).toHaveLength(1);
    expect(openRows()).toEqual([0]);
    expect(inputsOf(0).map((each) => each.value)).toEqual(["0", "4", "8", "25", "#000000"]);
  });

  it("ogni genere ha il nome del suo passo", () => {
    for (const [label, action] of [
      ["Ombra interna", "draw.action.effect_add.inner-shadow"],
      ["Bagliore esterno", "draw.action.effect_add.glow"],
      ["Bagliore interno", "draw.action.effect_add.inner-glow"],
      ["Sfocatura", "draw.action.effect_add.blur"],
    ] as const) {
      sent = [];
      mount(viewOf({ kind: "none" }));
      click(panel.add);
      click(entry(label));
      expect(lastSent().label).toBe(action);
      closeContextMenu();
      host.replaceChildren();
    }
  });

  it("in fondo all'elenco, aperto, e con la riga già aperta che si chiude", () => {
    mount(viewOf(listOf(SHADOW)));
    click(names()[0]!);
    click(panel.add);
    click(entry("Bagliore esterno"));
    expect(lastSent().change).toEqual({ kind: "add", effect: defaultEffect("glow") });
    expect(rows().map((row) => row.dataset.kind)).toEqual(["shadow", "glow"]);
    expect(openRows()).toEqual([1]);
  });

  it("dalla tastiera il fuoco va al nuovo effetto; col puntatore resta dov'era", () => {
    mount(viewOf(listOf(SHADOW)));
    panel.add.focus();
    key("ArrowDown");
    expect(panel.add.getAttribute("aria-expanded")).toBe("true");
    click(entry("Sfocatura"));
    expect(document.activeElement).toBe(names()[1]);
    // Col puntatore: il fuoco non era sul pulsante.
    mount(viewOf(listOf(SHADOW)));
    const outside = document.createElement("button");
    host.append(outside);
    outside.focus();
    click(panel.add);
    click(entry("Bagliore interno"));
    expect(document.activeElement).not.toBe(names()[1]);
  });

  it("la sfocatura è una sola: con una già c'è, spenta, e dice perché", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    click(panel.add);
    expect(entries().map((each) => each.getAttribute("aria-disabled"))).toEqual([null, null, null, null, "true"]);
    expect(reason("Sfocatura")).toBe("Un oggetto ha già una sfocatura: ne prende una sola.");
    click(entry("Sfocatura"));
    expect(sent).toEqual([]);
    expect(formatIssues(checkAccessibility(menu()))).toBe("");
  });

  it("a otto effetti tutte le voci sono spente, con il perché", () => {
    const eight = Array.from({ length: MAX_EFFECTS }, () => GLOW);
    mount(viewOf(listOf(...eight), { full: true }));
    click(panel.add);
    expect(entries().map((each) => each.getAttribute("aria-disabled"))).toEqual(["true", "true", "true", "true", "true"]);
    expect(entries().map((each) => each.querySelector(".menu-description")!.textContent)).toEqual(Array.from({ length: 5 }, () => "Un oggetto ha già 8 effetti: è il massimo."));
  });

  it("con un oggetto che non li prende, tutto è spento e dice perché", () => {
    mount(viewOf({ kind: "none" }, { refusal: "clipped" }));
    expect(panel.add.getAttribute("aria-disabled")).toBe("true");
    click(panel.add);
    expect(entries().every((each) => each.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(reason("Ombra esterna")).toContain("ritagliato o mascherato");
    expect(note().textContent).toContain("ritagliato o mascherato");
    expect(list().hidden).toBe(true);
  });

  it("in sola lettura le voci sono spente, e non cambiano niente", () => {
    mount(viewOf(listOf(SHADOW)), false);
    click(panel.add);
    expect(entries().every((each) => each.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(reason("Sfocatura")).toBe(READ_ONLY);
    expect(sent).toEqual([]);
  });

  it("se l'editor rifiuta l'aggiunta, la riga non si apre e lo dice a voce", () => {
    mount(viewOf(listOf(SHADOW)));
    refusal = "Non si può.";
    click(panel.add);
    click(entry("Sfocatura"));
    expect(announced).toEqual(["Non si può."]);
    expect(openRows()).toEqual([]);
    expect(rows()).toHaveLength(1);
  });

  it("richiude il menu, e il pulsante torna a dire che non è aperto", () => {
    mount();
    click(panel.add);
    expect(panel.add.getAttribute("aria-expanded")).toBe("true");
    key("Escape", {}, menu());
    expect(panel.add.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("effetti diversi e filtro d'altri", () => {
  it("con effetti diversi lo dice, e offre di darli tutti uguali o di toglierli", () => {
    mount(viewOf({ kind: "mixed", first: [SHADOW, BLUR] }, { count: 2 }));
    expect(state_().hidden).toBe(false);
    expect(state_().textContent).toBe("Effetti diversi");
    expect(note().textContent).toBe("Il primo oggetto che ne ha: Ombra esterna, Sfocatura.");
    expect(list().hidden).toBe(true);
    expect(rows()).toEqual([]);
    expect(one(".draw-effects-actions").hidden).toBe(false);
    expect(actionButtons().map((button) => [button.textContent, button.hidden, button.getAttribute("aria-disabled")])).toEqual([
      ["Usa questi effetti per tutti", false, null],
      ["Togli gli effetti", false, null],
    ]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    click(useButton());
    expect(lastSent().label).toBe("draw.action.effects_all");
    expect(lastSent().change).toEqual({ kind: "set", effects: [SHADOW, BLUR] });
    expect(announced).toEqual(["Gli stessi effetti per 2 oggetti."]);
    // Uguali, si mostrano e si cambiano insieme.
    expect(state_().hidden).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it("«Togli gli effetti» li toglie a tutti", () => {
    mount(viewOf({ kind: "mixed", first: [GLOW] }, { count: 3 }));
    click(clearButton());
    expect(lastSent().label).toBe("draw.action.effects_clear");
    expect(lastSent().change).toEqual({ kind: "clear" });
    expect(announced).toEqual(["Effetti tolti."]);
    expect(note().textContent).toContain("Nessun effetto");
  });

  it("se nessuno ha effetti da dare, «Usa questi effetti» c'è ma è spento", () => {
    mount(viewOf({ kind: "mixed", first: null }, { count: 2 }));
    expect(note().textContent).toBe("Nessun oggetto ha effetti da dare agli altri.");
    expect(useButton().getAttribute("aria-disabled")).toBe("true");
    expect(clearButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("aggiungere con elenchi diversi aggiunge a ciascuno, e nessuna riga si apre", () => {
    mount(viewOf({ kind: "mixed", first: [SHADOW] }, { count: 2 }));
    click(panel.add);
    click(entry("Bagliore esterno"));
    expect(lastSent().change).toEqual({ kind: "add", effect: defaultEffect("glow") });
    expect(lastSent().label).toBe("draw.action.effect_add.glow");
  });

  it("un filtro di un altro programma si vede e si toglie, e un effetto nuovo lo sostituisce", () => {
    mount(viewOf({ kind: "other" }));
    expect(state_().textContent).toBe("Un filtro di un altro programma");
    expect(note().textContent).toBe("FubDraw lo lascia com’è. Un effetto nuovo lo sostituisce.");
    expect(list().hidden).toBe(true);
    expect(useButton().hidden).toBe(true);
    expect(clearButton().hidden).toBe(false);
    expect(clearButton().textContent).toBe("Togli il filtro");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    click(clearButton());
    expect(lastSent().label).toBe("draw.action.filter_clear");
    expect(lastSent().change).toEqual({ kind: "clear" });
    expect(announced).toEqual(["Filtro tolto."]);
  });

  it("aggiungere a un filtro d'altri manda l'aggiunta, che lo sostituisce", () => {
    mount(viewOf({ kind: "other" }));
    click(panel.add);
    click(entry("Ombra esterna"));
    expect(lastSent().change).toEqual({ kind: "add", effect: defaultEffect("shadow") });
    expect(openRows()).toEqual([0]);
  });

  it("un rifiuto accanto agli effetti che ci sono lo dice sotto l'elenco", () => {
    mount(viewOf(listOf(SHADOW), { refusal: "unknown" }));
    expect(list().hidden).toBe(false);
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain("parti di un altro programma");
    expect(panel.add.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("il fuoco e la sola lettura", () => {
  it("il fuoco resta sul campo quando le righe si aggiornano", () => {
    mount();
    click(names()[0]!);
    input(0, "Y").focus();
    state.view = viewOf(listOf({ ...SHADOW, dy: 9 }, BLUR));
    update();
    expect(document.activeElement).toBe(input(0, "Y"));
    expect(input(0, "Y").value).toBe("9");
    // Un valore scritto a metà non si perde per un aggiornamento che non lo riguarda.
    type(input(0, "X"), "12");
    state.view = viewOf(listOf({ ...SHADOW, dy: 9 }, BLUR));
    update();
    expect(input(0, "X").value).toBe("12");
    expect(document.activeElement).toBe(input(0, "X"));
  });

  it("una riga che prende un altro genere rifà i suoi campi", () => {
    mount(viewOf(listOf(SHADOW)));
    click(names()[0]!);
    state.view = viewOf(listOf(BLUR));
    update();
    expect(labelsOf(0)).toEqual(["Raggio"]);
    expect(openRows()).toEqual([0]);
  });

  it("se il campo scompare con la riga, il fuoco resta nella sezione", () => {
    mount(viewOf(listOf(SHADOW, BLUR)));
    click(names()[1]!);
    input(1, "Raggio").focus();
    state.view = viewOf(listOf(SHADOW), { key: "oa" });
    update();
    expect(document.activeElement).toBe(panel.add);
  });

  it("in sola lettura tutto si guarda e niente cambia", () => {
    mount(viewOf(listOf(SHADOW, BLUR)), false);
    click(names()[0]!);
    expect(input(0, "X").readOnly).toBe(true);
    expect(pickerOf(0).disabled).toBe(true);
    expect([...shows(), ...removes(), panel.add].every((button) => button.getAttribute("aria-disabled") === "true")).toBe(true);
    click(shows()[0]!);
    click(removes()[1]!);
    expect(announced).toEqual([READ_ONLY, READ_ONLY]);
    type(input(0, "X"), "5");
    key("Enter");
    key("ArrowUp");
    expect(sent).toEqual([]);
    expect(announced).toEqual([READ_ONLY, READ_ONLY, READ_ONLY]);
    key("Delete", {}, names()[0]!);
    expect(sent).toEqual([]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("anche «Usa questi effetti» e «Togli» dicono che è in sola lettura", () => {
    mount(viewOf({ kind: "mixed", first: [SHADOW] }, { count: 2 }), false);
    click(useButton());
    click(clearButton());
    expect(sent).toEqual([]);
    expect(announced).toEqual([READ_ONLY, READ_ONLY]);
  });
});

describe("la lingua", () => {
  it("riscrive i testi e i numeri nella lingua dell'app", () => {
    mount(viewOf(listOf({ ...SHADOW, opacity: 0.255 }, GLOW)));
    click(names()[0]!);
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(panel.add.getAttribute("aria-label")).toBe("Add effect");
    expect(list().getAttribute("aria-label")).toBe("Effects");
    expect(rows().map((row) => row.querySelector(".draw-effect-title")!.textContent)).toEqual(["Drop shadow", "Outer glow"]);
    expect(labelsOf(0)).toEqual(["X", "Y", "Blur", "Opacity", "Color"]);
    expect(shows()[0]!.getAttribute("aria-label")).toBe("Show Drop shadow");
    expect(removes()[1]!.getAttribute("aria-label")).toBe("Remove Outer glow");
    expect(names()[1]!.querySelector(".sr-only")!.textContent).toBe(", size 8, opacity 75%");
    expect(input(0, "Opacity").value).toBe("25.5");
    click(panel.add);
    expect(entries().map((each) => each.querySelector(".menu-label")!.textContent)).toEqual(["Drop shadow", "Inner shadow", "Outer glow", "Inner glow", "Blur"]);
  });

  it("anche gli stati diversi e il filtro d'altri", () => {
    mount(viewOf({ kind: "mixed", first: [GLOW] }, { count: 2 }));
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(state_().textContent).toBe("Different effects");
    expect(note().textContent).toBe("The first object that has some: Outer glow.");
    expect(actionButtons().map((button) => button.textContent)).toEqual(["Use these effects for all", "Remove the effects"]);
    state.view = viewOf({ kind: "other" });
    update();
    expect(state_().textContent).toBe("A filter from another program");
    expect(clearButton().textContent).toBe("Remove the filter");
  });
});

describe("la vista, su un documento vero", () => {
  const rect = (id: string, x: number, more = ""): string => `<rect id="${id}" x="${x}" y="0" width="40" height="20"${more}/>`;
  const FOREIGN = '<filter id="ext" x="0" y="0" width="300" height="300" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2"/></filter>';

  function sheet(body: string, defs = ""): Opened {
    return open(doc(`${defs}${LAYER}${body}</g>`));
  }

  /// Dà `effects` a `ids`, come l'editor, e ne scrive il filtro.
  function give(opened: Opened, ids: readonly string[], effects: readonly Effect[]): void {
    const index = opened.reindex();
    const units = ids.map((id) => index.get(id)!);
    const out = effectsOps(opened.engine.model!, units, { kind: "set", effects }, estimate, new NewIds((id) => opened.engine.holder(id) !== null));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
  }

  const viewFor = (opened: Opened, ...ids: string[]): EffectsPanelView | null =>
    effectsView({
      model: opened.engine.model!,
      nodes: ids.map((id) => opened.engine.holder(id)!),
      measure: estimate,
      key: ids.join(","),
      unit: "px",
      swatches: [],
    });

  it("nessun effetto, gli stessi, o diversi", () => {
    const opened = sheet(rect("s", 0) + rect("b", 50) + rect("p", 100) + rect("s2", 150));
    give(opened, ["s", "s2"], [SHADOW]);
    give(opened, ["b"], [BLUR]);
    expect(viewFor(opened, "p")).toMatchObject({ body: { kind: "none" }, count: 1, refusal: null, full: false, blurred: false });
    expect(viewFor(opened, "s")).toMatchObject({ body: { kind: "list", effects: [SHADOW] }, count: 1 });
    expect(viewFor(opened, "s", "s2")).toMatchObject({ body: { kind: "list", effects: [SHADOW] }, count: 2 });
    const mixed = viewFor(opened, "p", "b", "s")!;
    expect(mixed.body).toEqual({ kind: "mixed", first: [BLUR] });
    expect(mixed.blurred).toBe(true);
    expect(viewFor(opened, "p", "s")!.body).toEqual({ kind: "mixed", first: [SHADOW] });
    expect(viewFor(opened, "p", "p")!.body.kind).toBe("none");
    // Gli stessi effetti scritti uguali, ma in ordine diverso, sono diversi.
    give(opened, ["p"], [SHADOW, GLOW]);
    give(opened, ["s"], [GLOW, SHADOW]);
    expect(viewFor(opened, "p", "s")!.body.kind).toBe("mixed");
    expect(viewFor(opened, "p", "p")!.body.kind).toBe("list");
  });

  it("un filtro di un altro programma, da solo o in mezzo agli altri", () => {
    const opened = sheet(rect("s", 0) + rect("o", 50, ' filter="url(#ext)"') + rect("p", 100), DEFS(FOREIGN));
    give(opened, ["s"], [SHADOW]);
    expect(viewFor(opened, "o")!.body).toEqual({ kind: "other" });
    expect(viewFor(opened, "o", "s")!.body.kind).toBe("mixed");
    expect(viewFor(opened, "o", "p")!.body.kind).toBe("mixed");
    expect(viewFor(opened, "o", "o")!.body).toEqual({ kind: "other" });
  });

  it("segna se un oggetto è già pieno o ha già la sfocatura", () => {
    const opened = sheet(rect("f", 0) + rect("b", 50) + rect("p", 100));
    give(opened, ["f"], Array.from({ length: MAX_EFFECTS }, () => GLOW));
    give(opened, ["b"], [BLUR]);
    expect(viewFor(opened, "f")).toMatchObject({ full: true, blurred: false });
    expect(viewFor(opened, "b")).toMatchObject({ full: false, blurred: true });
    expect(viewFor(opened, "p", "f")).toMatchObject({ full: true, blurred: false });
    expect(viewFor(opened, "p")).toMatchObject({ full: false, blurred: false });
  });

  it("un oggetto ritagliato dice perché non prende effetti", () => {
    const clip = '<clipPath id="c" fub:role="private"><rect width="5" height="5"/></clipPath>';
    const opened = sheet(rect("k", 0, ' clip-path="url(#c)"') + rect("p", 100), DEFS(clip));
    expect(viewFor(opened, "k")).toMatchObject({ refusal: "clipped" });
    expect(viewFor(opened, "p", "k")).toMatchObject({ refusal: "clipped" });
    expect(viewFor(opened, "p")).toMatchObject({ refusal: null });
  });

  it("senza oggetti che li prendano non c'è sezione", () => {
    const opened = sheet(rect("p", 0));
    expect(effectsView({ model: opened.engine.model!, nodes: [], measure: estimate, key: "", unit: "px", swatches: [] })).toBeNull();
    // Il livello non prende effetti, e nemmeno con un oggetto che li prende accanto.
    expect(viewFor(opened, "l1")).toBeNull();
    expect(viewFor(opened, "p", "l1")).toBeNull();
  });

  it("mille oggetti si leggono d'un fiato", () => {
    const count = 1000;
    const body = Array.from({ length: count }, (_, at) => rect(`r${at}`, at * 50)).join("");
    const opened = sheet(body);
    const ids = Array.from({ length: count }, (_, at) => `r${at}`);
    give(opened, ids.filter((_, at) => at % 2 === 0), [BLUR]);
    const started = performance.now();
    const view = viewFor(opened, ...ids)!;
    const took = performance.now() - started;
    expect(view.body.kind).toBe("mixed");
    expect(view.count).toBe(count);
    expect(view.blurred).toBe(true);
    expect(took).toBeLessThan(1500);
  });
});
