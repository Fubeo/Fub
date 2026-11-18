// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownGrammar } from "../../grammar";
import { livePreview } from "../../livepreview";
import { liveReveal } from "../../../../live-reveal";
import { propertiesDisplay } from "../../../../properties-display";
import { blocksMode } from "../../blocks/index";
import type { BlocksOptions } from "../../blocks/handles";
import { parsePropertyTypes } from "./kind";
import { parseDateInput } from "./editors";
import { loadLazyParts } from "../../../../../../ui/lazy-part";
import "../../../../../../i18n/strings";

// I pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci sono già,
// come dopo il riscaldamento: i gesti si guardano col loro codice.
beforeAll(loadLazyParts);

// Gli editor dei tipi della testata (T8): ogni modifica è una scrittura, un
// passo d'annullamento, e il file dice il valore nel modo in cui YAML lo
// legge. Ognuno da tastiera e col puntatore.

const views: EditorView[] = [];
beforeEach(() => {
  vi.stubGlobal("navigator", { language: "it" });
  vi.useFakeTimers({ toFake: ["Date"] });
  // Venerdì 20 marzo 2026.
  vi.setSystemTime(new Date(2026, 2, 20, 10, 0));
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Mounted {
  view: EditorView;
  notices: string[];
}

function mount(doc: string, options: Partial<BlocksOptions> & { readOnly?: boolean } = {}): Mounted {
  const notices: string[] = [];
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        propertiesDisplay.of("visible"),
        EditorState.readOnly.of(options.readOnly ?? false),
        blocksMode({ page: () => "Nota", notify: (message) => notices.push(message), ...options }),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return { view, notices };
}

const text = (view: EditorView) => view.state.doc.toString();
const row = (view: EditorView, key: string) => view.dom.querySelector<HTMLElement>(`.cm-fub-page-prop[data-key="${key}"]`)!;
const valueOf = (view: EditorView, key: string) => row(view, key).querySelector<HTMLElement>(".cm-fub-page-prop-value")!;
const popover = () => document.querySelector<HTMLElement>(".cm-fub-prop-popover")!;
const key = (target: Element, name: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
/// Il fuoco sul valore con ↓ dal titolo, come chi usa la tastiera, poi
/// Invio (il clic che il browser fa su un pulsante).
function byKeyboard(view: EditorView, name: string): HTMLElement {
  const title = view.dom.querySelector<HTMLInputElement>("input.cm-fub-page-title")!;
  title.focus();
  let at: HTMLElement = title;
  for (let i = 0; i < 20 && at !== valueOf(view, name); i++) {
    key(at, "ArrowDown");
    at = document.activeElement as HTMLElement;
  }
  expect(document.activeElement).toBe(valueOf(view, name));
  (document.activeElement as HTMLElement).click();
  return valueOf(view, name);
}

describe("testo e numero, in riga", () => {
  it("col puntatore: il valore diventa un campo, Invio scrive, un annullo lo rimette", () => {
    const { view } = mount("---\nluogo: Torino\n---\nTesto");
    valueOf(view, "luogo").click();
    const input = row(view, "luogo").querySelector<HTMLInputElement>("input.cm-fub-prop-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "Milano: centro";
    key(input, "Enter");
    expect(text(view)).toBe("---\nluogo: \"Milano: centro\"\n---\nTesto");
    expect(row(view, "luogo").querySelector("input")).toBeNull();
    undo(view);
    expect(text(view)).toBe("---\nluogo: Torino\n---\nTesto");
  });

  it("da tastiera: Esc torna al valore di prima e non scrive; l'uscita dal campo scrive", () => {
    const { view } = mount("---\nluogo: Torino\n---\nTesto");
    byKeyboard(view, "luogo");
    let input = row(view, "luogo").querySelector<HTMLInputElement>("input")!;
    input.value = "Roma";
    key(input, "Escape");
    expect(text(view)).toBe("---\nluogo: Torino\n---\nTesto");
    expect(document.activeElement).toBe(valueOf(view, "luogo"));
    valueOf(view, "luogo").click();
    input = row(view, "luogo").querySelector<HTMLInputElement>("input")!;
    input.value = "Roma";
    input.dispatchEvent(new FocusEvent("blur"));
    expect(text(view)).toBe("---\nluogo: Roma\n---\nTesto");
  });

  it("un numero si scrive come numero, anche all'italiana; ciò che non è un numero non si scrive e lo si dice", () => {
    const { view, notices } = mount("---\npagine: 12\n---\nTesto");
    expect(row(view, "pagine").dataset.kind).toBe("number");
    byKeyboard(view, "pagine");
    let input = row(view, "pagine").querySelector<HTMLInputElement>("input")!;
    expect(input.inputMode).toBe("decimal");
    input.value = "12,5";
    key(input, "Enter");
    expect(text(view)).toBe("---\npagine: 12.5\n---\nTesto");
    valueOf(view, "pagine").click();
    input = row(view, "pagine").querySelector<HTMLInputElement>("input")!;
    input.value = "tante";
    key(input, "Enter");
    expect(text(view)).toBe("---\npagine: 12.5\n---\nTesto");
    expect(notices).toContain("Non è un numero: il valore resta quello di prima.");
  });

  it("un valore che il registro dice numero e non lo è resta testo, segnato, e si scrive come testo", () => {
    const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { pagine: "number" } }));
    const { view } = mount("---\npagine: molte\n---\nTesto", { propertyTypes: () => types });
    expect(row(view, "pagine").dataset.kind).toBe("text");
    expect(row(view, "pagine").dataset.mismatch).toBe("number");
    expect(valueOf(view, "pagine").textContent).toContain("Non è numero: resta testo");
    // Il registro vince sul valore: un testo che sembra un numero, dichiarato
    // testo, si scrive come testo.
    const asText = parsePropertyTypes(JSON.stringify({ version: 1, types: { codice: "text" } }));
    const other = mount("---\ncodice: 0042\n---\n", { propertyTypes: () => asText });
    expect(row(other.view, "codice").dataset.kind).toBe("text");
  });
});

describe("la casella", () => {
  it("un clic la spunta e la toglie, ogni volta un passo d'annullamento; è una casella anche per chi non vede", () => {
    const { view } = mount("---\nfatto: false\n---\nTesto");
    const value = valueOf(view, "fatto");
    expect(value.getAttribute("role")).toBe("checkbox");
    expect(value.getAttribute("aria-checked")).toBe("false");
    value.click();
    expect(text(view)).toBe("---\nfatto: true\n---\nTesto");
    expect(valueOf(view, "fatto").getAttribute("aria-checked")).toBe("true");
    valueOf(view, "fatto").click();
    expect(text(view)).toBe("---\nfatto: false\n---\nTesto");
    undo(view);
    expect(text(view)).toBe("---\nfatto: true\n---\nTesto");
  });

  it("da tastiera il fuoco resta sulla casella dopo la scrittura", () => {
    const { view } = mount("---\nfatto: true\n---\nTesto");
    byKeyboard(view, "fatto");
    expect(text(view)).toBe("---\nfatto: false\n---\nTesto");
    expect(document.activeElement).toBe(valueOf(view, "fatto"));
  });
});

describe("la data", () => {
  it("col puntatore: un giorno del mese, «Domani», «Togli la data»", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    expect(row(view, "scadenza").dataset.kind).toBe("date");
    expect(valueOf(view, "scadenza").textContent).toContain("2 marzo 2026");
    valueOf(view, "scadenza").click();
    expect(popover().querySelector(".cm-fub-prop-date-head")!.textContent).toContain("marzo 2026");
    expect(popover().querySelector("[data-day='2026-03-02']")!.getAttribute("aria-pressed")).toBe("true");
    expect(popover().querySelector("[data-day='2026-03-20']")!.getAttribute("aria-current")).toBe("date");
    popover().querySelector<HTMLElement>("[data-day='2026-03-12']")!.click();
    expect(text(view)).toBe("---\nscadenza: 2026-03-12\n---\nTesto");
    expect(document.querySelector(".cm-fub-prop-popover")).toBeNull();
    valueOf(view, "scadenza").click();
    [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-choice")].find((b) => b.textContent === "Domani")!.click();
    expect(text(view)).toBe("---\nscadenza: 2026-03-21\n---\nTesto");
    valueOf(view, "scadenza").click();
    [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-action")].find((b) => b.textContent === "Togli la data")!.click();
    expect(text(view)).toBe("---\nscadenza:\n---\nTesto");
    undo(view);
    expect(text(view)).toBe("---\nscadenza: 2026-03-21\n---\nTesto");
  });

  it("da tastiera: le frecce nella griglia, Pagina giù per il mese, e la data scritta a mano", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    byKeyboard(view, "scadenza");
    const grid = popover().querySelector<HTMLElement>(".cm-fub-prop-date-grid")!;
    popover().querySelector<HTMLElement>("[data-day='2026-03-02']")!.focus();
    key(document.activeElement!, "ArrowRight");
    key(document.activeElement!, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.day).toBe("2026-03-10");
    key(document.activeElement!, "PageDown");
    expect((document.activeElement as HTMLElement).dataset.day).toBe("2026-04-10");
    expect(grid.getAttribute("aria-label")).toBe("aprile 2026");
    (document.activeElement as HTMLElement).click();
    expect(text(view)).toBe("---\nscadenza: 2026-04-10\n---\nTesto");
    valueOf(view, "scadenza").click();
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-date-field input")!;
    expect(document.activeElement).toBe(input);
    type(input, "31/2/2026");
    expect(input.getAttribute("aria-invalid")).not.toBeNull();
    key(input, "Enter");
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toContain("Non capisco «31/2/2026» come data");
    expect(text(view)).toBe("---\nscadenza: 2026-04-10\n---\nTesto");
    type(input, "5/5/2026");
    key(input, "Enter");
    expect(text(view)).toBe("---\nscadenza: 2026-05-05\n---\nTesto");
  });

  it("data e ora: un giorno tiene l'ora; «Aggiungi l'ora» la porta a una data", () => {
    const { view } = mount("---\ninizio: 2026-03-02T10:30\nscadenza: 2026-03-02\n---\n");
    expect(row(view, "inizio").dataset.kind).toBe("date_time");
    valueOf(view, "inizio").click();
    popover().querySelector<HTMLElement>("[data-day='2026-03-04']")!.click();
    expect(text(view)).toContain("inizio: 2026-03-04T10:30\n");
    valueOf(view, "scadenza").click();
    const toggle = [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-action")].find((b) => b.textContent === "Aggiungi l'ora")!;
    toggle.click();
    const time = popover().querySelector<HTMLInputElement>("input[type=time]")!;
    time.value = "18:00";
    key(time, "Enter");
    expect(text(view)).toContain("scadenza: 2026-03-02T18:00\n");
  });

  it("«Aggiungi l'ora» ha l'orologio davanti al testo: decorativo, e il nome del pulsante resta il testo", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    valueOf(view, "scadenza").click();
    const toggle = [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-action")].find((b) => b.textContent === "Aggiungi l'ora")!;
    const clock = toggle.firstElementChild!;
    expect(toggle.firstChild).toBe(clock);
    expect(clock.tagName.toLowerCase()).toBe("svg");
    expect(clock.getAttribute("data-icon")).toBe("clock");
    expect(clock.getAttribute("aria-hidden")).toBe("true");
    expect(toggle.hasAttribute("aria-label")).toBe(false);
    expect(toggle.textContent).toBe("Aggiungi l'ora");
    // Con l'ora il pulsante dice «Togli l'ora»: l'orologio resta, è lo stesso pulsante.
    toggle.click();
    expect(toggle.textContent).toBe("Togli l'ora");
    expect(toggle.firstElementChild?.getAttribute("data-icon")).toBe("clock");
  });

  it("la data scritta a mano: ISO, all'italiana, a parole, con l'ora", () => {
    const today = new Date(2026, 2, 20, 10, 0);
    const parse = (text: string) => parseDateInput(text, today, 1, "it");
    expect(parse("2026-03-20")).toEqual({ date: "2026-03-20", time: null });
    expect(parse("20/3/2026")).toEqual({ date: "2026-03-20", time: null });
    expect(parse("20.3.26")).toEqual({ date: "2026-03-20", time: null });
    expect(parse("2026-03-20 9:05")).toEqual({ date: "2026-03-20", time: "09:05" });
    expect(parse("2026-03-20T10:30")).toEqual({ date: "2026-03-20", time: "10:30" });
    expect(parse("domani")).toEqual({ date: "2026-03-21", time: null });
    expect(parse("venerdì 18:30")).toEqual({ date: "2026-03-27", time: "18:30" });
    expect(parse("domani alle 9")).toEqual({ date: "2026-03-21", time: "09:00" });
    expect(parse("tomorrow at 7:15")).toEqual({ date: "2026-03-21", time: "07:15" });
    expect(parse("30/2/2026")).toBeNull();
    expect(parse("domani 25:00")).toBeNull();
    expect(parse("domani alle")).toBeNull();
    expect(parse("20 marzo 26")).toEqual({ date: "2026-03-20", time: null });
  });
});

describe("la data a parole (T10)", () => {
  const field = () => popover().querySelector<HTMLInputElement>(".cm-fub-prop-date-field input")!;

  it("da tastiera: «fra tre settimane» si vede nel mese e Invio scrive il giorno ISO", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    byKeyboard(view, "scadenza");
    const input = field();
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe("venerdì, fra due settimane, 20 marzo…");
    expect(input.getAttribute("aria-label")).toBe("Data a parole");
    type(input, "fra tre settimane");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(popover().querySelector(".cm-fub-prop-date-head")!.textContent).toContain("aprile 2026");
    expect(popover().querySelector("[data-day='2026-04-10']")!.getAttribute("aria-pressed")).toBe("true");
    // Ancora niente nel file: le parole sono la resa, non il valore.
    expect(text(view)).toBe("---\nscadenza: 2026-03-02\n---\nTesto");
    key(input, "Enter");
    expect(text(view)).toBe("---\nscadenza: 2026-04-10\n---\nTesto");
    expect(document.querySelector(".cm-fub-prop-popover")).toBeNull();
    undo(view);
    expect(text(view)).toBe("---\nscadenza: 2026-03-02\n---\nTesto");
  });

  it("le parole del prototipo, una per volta", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    for (const [words, iso] of [["venerdì", "2026-03-27"], ["fra due settimane", "2026-04-03"], ["20 marzo", "2026-03-20"], ["3/4", "2026-04-03"], ["fra 0 giorni", "2026-03-20"]] as const) {
      valueOf(view, "scadenza").click();
      type(field(), words);
      key(field(), "Enter");
      expect(text(view)).toBe(`---\nscadenza: ${iso}\n---\nTesto`);
    }
  });

  it("col puntatore: ciò che non si capisce resta nel campo, lo dice, e il valore non cambia", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    valueOf(view, "scadenza").click();
    const input = field();
    type(input, "fra tre settimane");
    expect(popover().querySelector("[data-day='2026-04-10']")!.getAttribute("aria-pressed")).toBe("true");
    type(input, "fra poco");
    expect(input.hasAttribute("aria-invalid")).toBe(true);
    key(input, "Enter");
    // Il mese torna sul valore di prima, che resta.
    expect(popover().querySelector("[data-day='2026-03-02']")!.getAttribute("aria-pressed")).toBe("true");
    const note = popover().querySelector<HTMLElement>(".cm-fub-prop-note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("Non capisco «fra poco» come data: prova «venerdì», «fra due settimane», «20 marzo» o 20/3/2026. La data di prima non è cambiata.");
    expect(input.value).toBe("fra poco");
    expect(text(view)).toBe("---\nscadenza: 2026-03-02\n---\nTesto");
    // «31/2» non scivola al 3 marzo.
    type(input, "31/2");
    expect(note.hidden).toBe(true);
    key(input, "Enter");
    expect(note.hidden).toBe(false);
    expect(text(view)).toBe("---\nscadenza: 2026-03-02\n---\nTesto");
    // Il campo vuotato torna al valore di prima; Invio non fa niente.
    type(input, "");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    key(input, "Enter");
    expect(document.querySelector(".cm-fub-prop-popover")).not.toBeNull();
    // Un giorno scelto nel mese col puntatore scrive come sempre.
    popover().querySelector<HTMLElement>("[data-day='2026-03-12']")!.click();
    expect(text(view)).toBe("---\nscadenza: 2026-03-12\n---\nTesto");
  });

  it("una data a parole con l'ora diventa data e ora", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto");
    valueOf(view, "scadenza").click();
    type(field(), "venerdì 18:30");
    key(field(), "Enter");
    expect(text(view)).toBe("---\nscadenza: 2026-03-27T18:30\n---\nTesto");
    expect(row(view, "scadenza").dataset.kind).toBe("date_time");
  });

  it("«Aggiungi l'ora» su una proprietà dichiarata Data la dichiara Data e ora", async () => {
    const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { scadenza: "date" } }));
    const setPropertyType = vi.fn(async () => null);
    const { view, notices } = mount("---\nscadenza: 2026-03-02\n---\nTesto", { propertyTypes: () => types, setPropertyType });
    valueOf(view, "scadenza").click();
    const toggle = [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-action")].find((b) => b.textContent === "Aggiungi l'ora")!;
    expect(toggle.hidden).toBe(false);
    toggle.click();
    const time = popover().querySelector<HTMLInputElement>("input[type=time]")!;
    expect(document.activeElement).toBe(time);
    time.value = "18:00";
    key(time, "Enter");
    expect(text(view)).toBe("---\nscadenza: 2026-03-02T18:00\n---\nTesto");
    expect(setPropertyType).toHaveBeenCalledWith("scadenza", "date_time");
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toContain("«scadenza» ora è data e ora, in tutto il vault: le date senza ora restano come sono.");
  });

  it("una Data dichiarata senza registro da scrivere non offre l'ora, e un'ora scritta lo dice", () => {
    const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { scadenza: "date" } }));
    const { view } = mount("---\nscadenza: 2026-03-02\n---\nTesto", { propertyTypes: () => types });
    valueOf(view, "scadenza").click();
    const toggle = [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-date-action")].find((b) => b.textContent === "Aggiungi l'ora")!;
    expect(toggle.hidden).toBe(true);
    type(field(), "domani alle 9");
    key(field(), "Enter");
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toBe("«scadenza» è una data senza ora: scrivi solo il giorno.");
    expect(text(view)).toBe("---\nscadenza: 2026-03-02\n---\nTesto");
  });

  it("in inglese le parole e il campo parlano inglese", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const { view } = mount("---\ndue: 2026-03-02\n---\nText");
    valueOf(view, "due").click();
    expect(field().placeholder).toBe("Friday, in two weeks, March 20…");
    type(field(), "in two weeks");
    key(field(), "Enter");
    expect(text(view)).toBe("---\ndue: 2026-04-03\n---\nText");
    valueOf(view, "due").click();
    type(field(), "4/3");
    key(field(), "Enter");
    expect(text(view)).toBe("---\ndue: 2026-04-03\n---\nText");
  });
});

describe("elenco ed etichette", () => {
  it("da tastiera: Invio aggiunge (anche più voci), Backspace nel campo vuoto toglie l'ultima; la forma dell'elenco resta", () => {
    const { view } = mount("---\nluoghi:\n  - Torino\n---\nTesto");
    expect(row(view, "luoghi").dataset.kind).toBe("list");
    byKeyboard(view, "luoghi");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-list-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "Milano, Roma";
    key(input, "Enter");
    expect(text(view)).toBe("---\nluoghi:\n  - Torino\n  - Milano\n  - Roma\n---\nTesto");
    expect(input.value).toBe("");
    key(input, "Backspace");
    expect(text(view)).toBe("---\nluoghi:\n  - Torino\n  - Milano\n---\nTesto");
    undo(view);
    expect(text(view)).toBe("---\nluoghi:\n  - Torino\n  - Milano\n  - Roma\n---\nTesto");
  });

  it("col puntatore: la «×» di una voce la toglie; le etichette senza #", () => {
    const { view } = mount("---\ntemi: [arte, storia]\n---\nTesto", {
      propertyTypes: () => parsePropertyTypes(JSON.stringify({ version: 1, types: { temi: "tags" } })),
    });
    expect(row(view, "temi").dataset.kind).toBe("tags");
    expect(valueOf(view, "temi").textContent).toBe("#arte#storia");
    valueOf(view, "temi").click();
    popover().querySelector<HTMLElement>("[aria-label='Togli «arte»']")!.click();
    expect(text(view)).toBe("---\ntemi: [storia]\n---\nTesto");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-list-input")!;
    input.value = "#musica";
    key(input, "Enter");
    expect(text(view)).toBe("---\ntemi: [storia, musica]\n---\nTesto");
  });

  it("cento voci stanno nel riquadro, che scorre", () => {
    const items = Array.from({ length: 100 }, (_, i) => `v${i}`);
    const { view } = mount(`---\nvoci: [${items.join(", ")}]\n---\n`);
    valueOf(view, "voci").click();
    expect(popover().querySelectorAll(".cm-fub-prop-chip")).toHaveLength(100);
    expect(valueOf(view, "voci").querySelectorAll(".cm-fub-prop-chip")).toHaveLength(100);
  });
});

describe("le persone", () => {
  const people = async (text: string) => ["Anna Rossi", "Bruno Neri", "Carla Bianchi"].filter((name) => name.toLowerCase().includes(text.toLowerCase()));

  it("da tastiera: la ricerca, ↓ e Invio mettono una persona; il valore è un elenco di link", async () => {
    const { view } = mount("---\npersone:\n  - \"[[Anna Rossi]]\"\n---\nTesto", { searchPeople: people });
    expect(row(view, "persone").dataset.kind).toBe("people");
    expect(valueOf(view, "persone").textContent).toBe("ARAnna Rossi");
    byKeyboard(view, "persone");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!;
    expect(document.activeElement).toBe(input);
    type(input, "bru");
    await Promise.resolve();
    await Promise.resolve();
    const options = () => [...popover().querySelectorAll<HTMLElement>("[role=option]")];
    expect(options().map((option) => option.textContent)).toEqual(["BNBruno Neri", "Aggiungi «bru»"]);
    key(input, "Enter");
    expect(text(view)).toBe("---\npersone:\n  - \"[[Anna Rossi]]\"\n  - \"[[Bruno Neri]]\"\n---\nTesto");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("col puntatore: un clic toglie chi c'è; un nome che la ricerca non trova si aggiunge come link", async () => {
    const { view } = mount("---\npersone: [\"[[Anna Rossi]]\", \"[[Bruno Neri]]\"]\n---\n", { searchPeople: people });
    valueOf(view, "persone").click();
    await Promise.resolve();
    const option = (label: string) => [...popover().querySelectorAll<HTMLElement>("[role=option]")].find((element) => element.textContent?.includes(label))!;
    option("Anna Rossi").click();
    expect(text(view)).toBe("---\npersone: [\"[[Bruno Neri]]\"]\n---\n");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!;
    type(input, "Dario Verdi");
    await Promise.resolve();
    option("Aggiungi «Dario Verdi»").click();
    expect(text(view)).toBe("---\npersone: [\"[[Bruno Neri]]\", \"[[Dario Verdi]]\"]\n---\n");
  });
});

describe("la Relazione (T35)", () => {
  const notes = [
    { doc: "Libri/Dune.md", link: "[[Libri/Dune]]" },
    { doc: "Libri/Solaris.md", link: "[[Libri/Solaris]]" },
    { doc: "Libri/Ubik.md", link: "[[Libri/Ubik]]" },
  ];
  const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { libri: "relation" }, targets: { libri: "Libri" } }));
  const port = (opened: string[] = [], asked: unknown[] = []) => ({
    search: async (text: string, target: unknown) => {
      asked.push(target);
      return notes.filter((note) => note.doc.toLowerCase().includes(text.toLowerCase()));
    },
    create: async (name: string) => ({ doc: `Libri/${name}.md`, link: `[[Libri/${name}]]` }),
    open: (link: string) => { opened.push(link); },
  });
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const options = () => [...popover().querySelectorAll<HTMLElement>("[role=option]")];

  it("si legge come i nomi delle note, e il nome apre la nota", () => {
    const opened: string[] = [];
    const { view } = mount("---\nlibri: [\"[[Libri/Dune]]\", \"[[Solaris|Il pianeta]]\"]\n---\n", { propertyTypes: () => types, relations: port(opened) });
    expect(row(view, "libri").dataset.kind).toBe("relation");
    expect(valueOf(view, "libri").textContent).toBe("Dune, Il pianeta");
    valueOf(view, "libri").querySelector<HTMLElement>(".cm-fub-prop-rel")!.click();
    expect(opened).toEqual(["[[Libri/Dune]]"]);
    expect(document.querySelector(".cm-fub-prop-popover")).toBeNull();
    key(valueOf(view, "libri"), "Enter", { altKey: true });
    expect(opened).toEqual(["[[Libri/Dune]]", "[[Libri/Dune]]"]);
  });

  it("un link solo scritto come testo è una Relazione: `tipo` mostra il nome, non il testo grezzo", () => {
    const { view } = mount("---\ntipo: \"[[Tipi/Libro]]\"\n---\n", { relations: port() });
    expect(row(view, "tipo").dataset.kind).toBe("relation");
    expect(valueOf(view, "tipo").textContent).toBe("Libro");
  });

  it("da tastiera: la ricerca nel bersaglio, ↓ e Invio legano una nota; il valore è un elenco di link", async () => {
    const asked: unknown[] = [];
    const { view } = mount("---\nlibri: [\"[[Libri/Dune]]\"]\n---\nTesto", { propertyTypes: () => types, relations: port([], asked) });
    byKeyboard(view, "libri");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!;
    expect(document.activeElement).toBe(input);
    await settle();
    expect(asked[0]).toEqual({ kind: "folder", path: "Libri" });
    expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    type(input, "sol");
    await settle();
    expect(options().map((option) => option.textContent)).toEqual(["Note", "SolarisLibri", "Crea «sol»in «Libri», legata qui"]);
    key(input, "Enter");
    expect(text(view)).toBe("---\nlibri: [\"[[Libri/Dune]]\", \"[[Libri/Solaris]]\"]\n---\nTesto");
  });

  it("col puntatore: un clic toglie una nota legata; un nome che non c'è si crea e si lega", async () => {
    const { view } = mount("---\nlibri: [\"[[Libri/Dune]]\", \"[[Libri/Ubik]]\"]\n---\n", { propertyTypes: () => types, relations: port() });
    valueOf(view, "libri").click();
    await settle();
    const option = (label: string) => options().find((element) => element.textContent?.includes(label))!;
    option("Dune").click();
    expect(text(view)).toBe("---\nlibri: [\"[[Libri/Ubik]]\"]\n---\n");
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!;
    type(input, "Neuromante");
    await settle();
    expect(popover().querySelector(".cm-fub-prop-empty")!.hasAttribute("hidden")).toBe(true);
    option("Crea «Neuromante»").click();
    await settle();
    expect(text(view)).toBe("---\nlibri: [\"[[Libri/Ubik]]\", \"[[Libri/Neuromante]]\"]\n---\n");
  });

  it("una nota che non si crea lo dice con la specie dell'errore, e il valore non cambia", async () => {
    const refusing = { ...port(), create: async (): Promise<never> => { throw { kind: "conflict", message: "il registro è cambiato" }; } };
    const { view } = mount("---\nlibri: [\"[[Libri/Dune]]\"]\n---\n", { propertyTypes: () => types, relations: refusing });
    valueOf(view, "libri").click();
    await settle();
    type(popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!, "Neuromante");
    await settle();
    options().find((element) => element.textContent?.includes("Crea «Neuromante»"))!.click();
    await vi.waitFor(() => expect(popover().querySelector<HTMLElement>(".cm-fub-prop-note")!.hidden).toBe(false));
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toBe("La nota «Neuromante» non è stata creata: nel frattempo è cambiato");
    expect(text(view)).toBe("---\nlibri: [\"[[Libri/Dune]]\"]\n---\n");
  });

  it("il bersaglio senza note lo dice; un link solo resta un link solo", async () => {
    const empty = { search: async () => [], open: () => {} };
    const { view } = mount("---\nautore: \"[[Mario]]\"\n---\n", { relations: empty });
    valueOf(view, "autore").click();
    await settle();
    const option = (label: string) => options().find((element) => element.textContent?.includes(label))!;
    option("Mario").click();
    expect(text(view)).toBe("---\nautore:\n---\n");
    // Niente di legato, niente trovato: il riquadro lo dice.
    const said = popover().querySelector<HTMLElement>(".cm-fub-prop-empty")!;
    expect(said.hidden).toBe(false);
    expect(said.textContent).toBe("Il vault non ha ancora note: scrivi un nome per crearne una");
  });

  it("in sola lettura il nome è un link che apre la nota, e il valore non si modifica", () => {
    const opened: string[] = [];
    const { view } = mount("---\nlibri: [\"[[Libri/Dune]]\"]\n---\n", { readOnly: true, propertyTypes: () => types, relations: port(opened) });
    const link = valueOf(view, "libri").querySelector<HTMLAnchorElement>("a.cm-fub-prop-rel")!;
    link.click();
    expect(opened).toEqual(["[[Libri/Dune]]"]);
    expect(document.querySelector(".cm-fub-prop-popover")).toBeNull();
  });

  it("cento note legate stanno tutte nel riquadro, spuntate", async () => {
    const many = Array.from({ length: 100 }, (_, i) => `"[[Libri/N${i}]]"`).join(", ");
    const { view } = mount(`---\nlibri: [${many}]\n---\n`, { propertyTypes: () => types, relations: port() });
    expect(valueOf(view, "libri").querySelectorAll(".cm-fub-prop-rel")).toHaveLength(100);
    valueOf(view, "libri").click();
    await settle();
    expect(options().filter((option) => option.getAttribute("aria-selected") === "true")).toHaveLength(100);
  });
});

describe("aprire e uscire senza cambiare niente non riscrive il file (revisione #421)", () => {
  // Ciò che la testata mostra non è il testo scritto: un'uscita senza
  // modifiche non deve diventare una scrittura che lo «normalizza».
  for (const line of [
    'a: "  spazi"',
    'a: "riga\\tdue"',
    'a: "caff\\u00e8"',
    "a: 007",
    "a: 1.10",
    "a: 1e3",
    "a: 'single'",
    "a: 'l''altro'",
    "a: testo  ",
  ]) {
    it(`in riga: ${line}`, () => {
      const doc = `---\n${line}\n---\nTesto`;
      const { view } = mount(doc);
      valueOf(view, "a").click();
      const input = row(view, "a").querySelector<HTMLInputElement>("input")!;
      input.dispatchEvent(new FocusEvent("blur"));
      expect(text(view)).toBe(doc);
      byKeyboard(view, "a");
      key(row(view, "a").querySelector<HTMLInputElement>("input")!, "Enter");
      expect(text(view)).toBe(doc);
    });
  }

  it("gli escape fra virgolette doppie si leggono davvero, e una modifica li riscrive fedeli", () => {
    const { view } = mount('---\na: "riga\\tdue"\n---\n');
    expect(valueOf(view, "a").textContent).toBe("riga\tdue");
    valueOf(view, "a").click();
    const input = row(view, "a").querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("riga\tdue");
    input.value = "riga\tdue!";
    key(input, "Enter");
    expect(text(view)).toBe('---\na: "riga\\tdue!"\n---\n');
  });

  it("uno escape che YAML non conosce non si riscrive: si apre lo YAML", () => {
    const doc = '---\na: "strano \\q"\n---\nTesto';
    const { view } = mount(doc);
    valueOf(view, "a").click();
    expect(row(view, "a")?.querySelector("input") ?? null).toBeNull();
    expect(text(view)).toBe(doc);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('a: "strano \\q"');
  });

  it("il testo scritto con spazi ai bordi resta com'è, fra virgolette", () => {
    const { view } = mount("---\na: x\n---\n");
    valueOf(view, "a").click();
    const input = row(view, "a").querySelector<HTMLInputElement>("input")!;
    input.value = "  y ";
    key(input, "Enter");
    expect(text(view)).toBe('---\na: "  y "\n---\n');
  });

  it("data, data e ora, elenco, persone: aperti e chiusi con Esc", () => {
    const doc = '---\nd: 2026-03-02\nt: 2026-03-20T10:30:45+01:00\nl: [ uno,  "due" ]\np: ["[[Anna]]"]\n---\n';
    const { view } = mount(doc, { searchPeople: async () => [] });
    for (const name of ["d", "t", "l", "p"]) {
      valueOf(view, name).click();
      expect(document.querySelector(".cm-fub-prop-popover"), name).not.toBeNull();
      key(document.activeElement ?? popover(), "Escape");
      expect(document.querySelector(".cm-fub-prop-popover"), name).toBeNull();
      expect(text(view), name).toBe(doc);
    }
  });

  it("la data: scegliere lo stesso giorno non riscrive niente", () => {
    const doc = "---\nd: 2026-03-02\n---\n";
    const { view } = mount(doc);
    valueOf(view, "d").click();
    popover().querySelector<HTMLElement>("[data-day='2026-03-02']")!.click();
    expect(text(view)).toBe(doc);
  });

  it("la casella: il fuoco che entra ed esce non scrive", () => {
    const doc = "---\nc: TRUE\n---\n";
    const { view } = mount(doc);
    const value = valueOf(view, "c");
    value.focus();
    value.blur();
    expect(text(view)).toBe(doc);
  });
});

describe("dentro una scheda della lavagna (revisione #421)", () => {
  // La scheda esce con Esc ascoltandolo sul suo elemento, in bolla (come
  // `engine.ts`): Esc in un editor della testata chiude l'editor, non la scheda.
  function cardAround(view: EditorView): string[] {
    const left: string[] = [];
    const card = document.createElement("div");
    view.dom.replaceWith(card);
    card.append(view.dom);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) left.push("esce");
    });
    return left;
  }

  it("Esc nel riquadro di data, elenco e persone chiude il riquadro, e la scheda resta", () => {
    const { view } = mount('---\nd: 2026-03-02\nl: [uno]\np: ["[[Anna]]"]\n---\n', { searchPeople: async () => [] });
    const left = cardAround(view);
    for (const name of ["d", "l", "p"]) {
      valueOf(view, name).click();
      const focused = document.activeElement!;
      expect(popover().contains(focused), name).toBe(true);
      key(focused, "Escape");
      expect(document.querySelector(".cm-fub-prop-popover"), name).toBeNull();
    }
    expect(left).toEqual([]);
  });

  it("Esc nel campo in riga annulla il campo, e la scheda resta", () => {
    const { view } = mount("---\na: uno\n---\n");
    const left = cardAround(view);
    valueOf(view, "a").click();
    key(row(view, "a").querySelector("input")!, "Escape");
    expect(row(view, "a").querySelector("input")).toBeNull();
    expect(left).toEqual([]);
  });
});

describe("data e ora tengono secondi e fuso (revisione #421)", () => {
  it("cambiato il giorno, l'ora com'era scritta resta tutta; cambiata l'ora, la coda va", () => {
    const { view } = mount("---\nt: 2026-03-20T10:30:45+01:00\n---\n");
    valueOf(view, "t").click();
    popover().querySelector<HTMLElement>("[data-day='2026-03-21']")!.click();
    expect(text(view)).toBe("---\nt: 2026-03-21T10:30:45+01:00\n---\n");
    valueOf(view, "t").click();
    const time = popover().querySelector<HTMLInputElement>("input[type=time]")!;
    time.value = "11:00";
    key(time, "Enter");
    expect(text(view)).toBe("---\nt: 2026-03-21T11:00\n---\n");
  });

  it("il separatore spazio resta", () => {
    const { view } = mount("---\nt: 2026-03-20 10:30\n---\n");
    valueOf(view, "t").click();
    popover().querySelector<HTMLElement>("[data-day='2026-03-22']")!.click();
    expect(text(view)).toBe("---\nt: 2026-03-22 10:30\n---\n");
  });
});

describe("Selezione e Stato: le opzioni come pastiglie (prototipo, `.opt`)", () => {
  const registry = () => parsePropertyTypes(JSON.stringify({
    version: 1,
    types: { stato: "status", sala: "select", fase: "status" },
    options: {
      stato: [{ name: "Da iniziare" }, { name: "In corso", color: "orange", group: "doing" }],
      sala: [{ name: "Grande", color: "blue" }, { name: "Piccola", color: "viola" }],
    },
  }));

  it("un'opzione del registro è la pastiglia del suo colore; lo Stato ha il pallino", () => {
    const { view } = mount("---\nstato: In corso\nsala: Grande\n---\nTesto", { propertyTypes: registry });
    const status = valueOf(view, "stato").querySelector<HTMLElement>(".cm-fub-prop-opt")!;
    expect(status.textContent).toBe("In corso");
    expect(status.dataset.color).toBe("orange");
    expect(status.hasAttribute("data-status")).toBe(true);
    const select = valueOf(view, "sala").querySelector<HTMLElement>(".cm-fub-prop-opt")!;
    expect(select.dataset.color).toBe("blue");
    expect(select.hasAttribute("data-status")).toBe(false);
    expect(valueOf(view, "sala").getAttribute("aria-label")).toContain("Grande");
  });

  it("un colore che manca o che non si conosce è grigio, come nel core", () => {
    const { view } = mount("---\nstato: Da iniziare\nsala: Piccola\n---\n", { propertyTypes: registry });
    expect(valueOf(view, "stato").querySelector<HTMLElement>(".cm-fub-prop-opt")!.dataset.color).toBe("gray");
    expect(valueOf(view, "sala").querySelector<HTMLElement>(".cm-fub-prop-opt")!.dataset.color).toBe("gray");
  });

  it("un valore fuori dalle opzioni, o senza opzioni, resta testo, segnato; il clic apre le opzioni", () => {
    const { view } = mount("---\nstato: Boh\nfase: Prima\n---\n", { propertyTypes: registry });
    expect(valueOf(view, "stato").querySelector(".cm-fub-prop-opt")).toBeNull();
    expect(valueOf(view, "stato").firstChild!.textContent).toBe("Boh");
    expect(row(view, "stato").hasAttribute("data-outside")).toBe(true);
    expect(valueOf(view, "stato").querySelector(".cm-fub-prop-mismatch")!.textContent).toBe("Fuori dalle opzioni: resta testo");
    expect(valueOf(view, "fase").querySelector(".cm-fub-prop-opt")).toBeNull();
    expect(row(view, "fase").hasAttribute("data-outside")).toBe(true);
    valueOf(view, "stato").click();
    expect(row(view, "stato").querySelector("input")).toBeNull();
    expect(popover().querySelector(".cm-fub-prop-choices")).not.toBeNull();
    expect(text(view)).toBe("---\nstato: Boh\nfase: Prima\n---\n");
  });

  it("il nome ha la figura del tipo dichiarato, anche per un valore fuori dalle opzioni", () => {
    const { view } = mount("---\nstato: Boh\nsala: Grande\nluogo: Torino\n---\n", { propertyTypes: registry });
    const icon = (key: string) => row(view, key).querySelector(".cm-fub-page-prop-key svg")?.getAttribute("data-icon");
    expect(icon("stato")).toBe("prop-status");
    expect(icon("sala")).toBe("prop-select");
    expect(icon("luogo")).toBe("prop-text");
  });

  it("in sola lettura (e in Lettura) la pastiglia resta", () => {
    const { view } = mount("---\nstato: In corso\n---\n", { propertyTypes: registry, readOnly: true });
    expect(row(view, "stato").querySelector(".cm-fub-page-prop-value .cm-fub-prop-opt")!.textContent).toBe("In corso");
  });
});

describe("Selezione e Stato: l'editor delle opzioni (prototipo, `propEditor`, passo 4)", () => {
  const registry = () => parsePropertyTypes(JSON.stringify({
    version: 1,
    types: { stato: "status", sala: "select" },
    options: {
      stato: [
        { name: "Da iniziare" },
        { name: "In corso", color: "orange", group: "doing" },
        { name: "In attesa", color: "yellow", group: "doing" },
        { name: "Fatto", color: "green", group: "done" },
        { name: "Annullato", color: "red", group: "done" },
      ],
      sala: [{ name: "Grande", color: "blue" }, { name: "Piccola", color: "green" }, { name: "Grande", color: "red" }],
    },
  }));
  const rows = () => [...popover().querySelectorAll<HTMLElement>("[role=option]")];
  const search = () => popover().querySelector<HTMLInputElement>(".cm-fub-prop-search input")!;

  it("lo Stato raggruppa le opzioni in Da fare, In corso, Fatto, coi colori; il valore è spuntato", () => {
    const { view } = mount("---\nstato: In corso\n---\nTesto", { propertyTypes: registry });
    expect(row(view, "stato").dataset.kind).toBe("status");
    valueOf(view, "stato").click();
    expect(rows().map((element) => element.textContent)).toEqual([
      "Da fare", "Da iniziare", "In corso", "✓In corso", "In attesa", "Fatto", "Fatto", "Annullato",
    ]);
    const heads = rows().filter((element) => element.classList.contains("cm-fub-prop-group"));
    expect(heads.map((element) => element.getAttribute("aria-disabled"))).toEqual(["true", "true", "true"]);
    const pills = [...popover().querySelectorAll<HTMLElement>(".cm-fub-prop-opt")];
    expect(pills.map((pill) => pill.dataset.color)).toEqual(["gray", "orange", "yellow", "green", "red"]);
    expect(pills.every((pill) => pill.hasAttribute("data-status"))).toBe(true);
    expect(rows().find((element) => element.textContent === "✓In corso")!.getAttribute("aria-selected")).toBe("true");
    expect(popover().querySelector(".cm-fub-prop-foot")!.textContent).toContain("valgono per ogni nota con «stato»");
  });

  it("da tastiera: la ricerca filtra, ↓ salta le intestazioni, Invio scrive; un annullo lo rimette", () => {
    const { view } = mount("---\nstato: In corso\n---\nTesto", { propertyTypes: registry });
    byKeyboard(view, "stato");
    const input = search();
    expect(document.activeElement).toBe(input);
    type(input, "a");
    // Le opzioni con una «a», nei loro gruppi: la prima è attiva.
    expect(rows().map((element) => element.textContent)).toEqual(["Da fare", "Da iniziare", "In corso", "In attesa", "Fatto", "Fatto", "Annullato"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows()[1]!.id);
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(rows().find((element) => element.textContent === "In attesa")!.id);
    key(input, "Enter");
    expect(text(view)).toBe("---\nstato: In attesa\n---\nTesto");
    expect(document.querySelector(".cm-fub-prop-choices")).toBeNull();
    expect(valueOf(view, "stato").querySelector<HTMLElement>(".cm-fub-prop-opt")!.dataset.color).toBe("yellow");
    undo(view);
    expect(text(view)).toBe("---\nstato: In corso\n---\nTesto");
  });

  it("col puntatore: la Selezione non ha gruppi; due opzioni con lo stesso nome valgono una, la prima", () => {
    const { view } = mount("---\nsala: Grande\n---\n", { propertyTypes: registry });
    valueOf(view, "sala").click();
    expect(rows().map((element) => element.textContent)).toEqual(["✓Grande", "Piccola"]);
    expect(popover().querySelector<HTMLElement>(".cm-fub-prop-opt")!.dataset.color).toBe("blue");
    expect(popover().querySelector(".cm-fub-prop-opt[data-status]")).toBeNull();
    rows()[1]!.click();
    expect(text(view)).toBe("---\nsala: Piccola\n---\n");
  });

  it("un nome che non c'è si crea nel registro, in Da fare con un colore libero, e diventa il valore", async () => {
    const added: unknown[] = [];
    const addPropertyOption = vi.fn(async (key: string, option: unknown) => { added.push([key, option]); return null; });
    const { view } = mount("---\nstato: Fatto\n---\n", { propertyTypes: registry, addPropertyOption });
    valueOf(view, "stato").click();
    type(search(), "Rivista");
    const create = rows().find((element) => element.classList.contains("cm-fub-prop-create"))!;
    expect(create.textContent).toBe("Crea «Rivista»in Da fare, con un colore libero");
    expect(search().getAttribute("aria-activedescendant")).toBe(create.id);
    key(search(), "Enter");
    await vi.waitFor(() => expect(text(view)).toBe("---\nstato: Rivista\n---\n"));
    // Grigio, arancio, giallo, verde e rosso ci sono: il primo libero è il blu.
    expect(added).toEqual([["stato", { name: "Rivista", color: "blue", group: "todo" }]]);
  });

  it("la Selezione crea senza gruppo; un nome che c'è già non si crea; senza registro scrivibile non c'è «Crea»", async () => {
    const addPropertyOption = vi.fn(async () => null);
    const { view } = mount("---\nsala: Grande\nstato: Fatto\n---\n", { propertyTypes: registry, addPropertyOption });
    valueOf(view, "sala").click();
    type(search(), "Piccola");
    expect(rows().some((element) => element.classList.contains("cm-fub-prop-create"))).toBe(false);
    type(search(), "Media");
    expect(rows().map((element) => element.textContent)).toEqual(["Crea «Media»con un colore libero"]);
    rows()[0]!.click();
    await vi.waitFor(() => expect(text(view)).toContain("sala: Media"));
    expect(addPropertyOption).toHaveBeenCalledWith("sala", { name: "Media", color: "orange", group: null });
    const plain = mount("---\nstato: Fatto\n---\n", { propertyTypes: registry });
    valueOf(plain.view, "stato").click();
    type(search(), "Nuova");
    expect(rows()).toHaveLength(0);
    expect(popover().querySelector<HTMLElement>(".cm-fub-prop-empty")!.hidden).toBe(false);
  });

  it("un registro che non si scrive: l'opzione non si crea, il riquadro lo dice e la nota non cambia", async () => {
    const addPropertyOption = vi.fn(async () => "il registro dei tipi non si legge, e non si riscrive");
    const { view } = mount("---\nstato: Fatto\n---\n", { propertyTypes: registry, addPropertyOption });
    valueOf(view, "stato").click();
    type(search(), "Rivista");
    key(search(), "Enter");
    await vi.waitFor(() => expect(popover().querySelector<HTMLElement>(".cm-fub-prop-note")!.hidden).toBe(false));
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toBe("L'opzione «Rivista» non è stata creata: il registro dei tipi non si legge, e non si riscrive");
    expect(text(view)).toBe("---\nstato: Fatto\n---\n");
  });

  it("un registro che rifiuta con un errore tipizzato dice la specie, non «[object Object]»", async () => {
    const addPropertyOption = vi.fn(async (): Promise<string | null> => {
      throw { kind: "already_exists", message: "L'opzione c'è già nel registro" };
    });
    const { view } = mount("---\nstato: Fatto\n---\n", { propertyTypes: registry, addPropertyOption });
    valueOf(view, "stato").click();
    type(search(), "Rivista");
    key(search(), "Enter");
    await vi.waitFor(() => expect(popover().querySelector<HTMLElement>(".cm-fub-prop-note")!.hidden).toBe(false));
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toBe("L'opzione «Rivista» non è stata creata: esiste già qualcosa con lo stesso nome");
    expect(text(view)).toBe("---\nstato: Fatto\n---\n");
  });

  it("il valore cambia mentre le opzioni sono aperte: non si scrive, la scelta resta e «Scrivi la mia» la scrive", () => {
    const { view } = mount("---\nstato: Fatto\n---\n", { propertyTypes: registry });
    valueOf(view, "stato").click();
    view.dispatch({ changes: { from: 11, to: 16, insert: "In corso" } });
    rows().find((element) => element.textContent?.endsWith("Annullato"))!.click();
    expect(text(view)).toBe("---\nstato: In corso\n---\n");
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toContain("ora vale «In corso»");
    expect(rows().find((element) => element.textContent === "✓Annullato")!.getAttribute("aria-selected")).toBe("true");
    popover().querySelector<HTMLElement>(".cm-fub-prop-note-action")!.click();
    expect(text(view)).toBe("---\nstato: Annullato\n---\n");
  });

  it("un'opzione che sembra un numero si scrive come testo", () => {
    const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { voto: "select" }, options: { voto: [{ name: "3" }, { name: "true" }] } }));
    const { view } = mount("---\nvoto: \"3\"\n---\n", { propertyTypes: () => types });
    valueOf(view, "voto").click();
    rows()[1]!.click();
    expect(text(view)).toBe("---\nvoto: \"true\"\n---\n");
  });

  it("il menu «Tipo» offre Selezione e Stato dopo il numero", () => {
    const { view } = mount("---\nluogo: Torino\n---\n", { setPropertyType: async () => null });
    row(view, "luogo").querySelector<HTMLElement>(".cm-fub-page-prop-key")!.click();
    [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.startsWith("Tipo"))!.click();
    const names = [...document.querySelectorAll<HTMLElement>("[role=menuitemradio]")].map((item) => item.querySelector(".cm-fub-prop-menu-label")!.textContent);
    expect(names.slice(0, 4)).toEqual(["Testo", "Numero", "Selezione", "Stato"]);
  });
});

describe("l'indirizzo: un link che si apre col clic e si modifica con la matita", () => {
  it("il clic apre il sito, la matita (o F2) lo modifica in riga", () => {
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => { opened.push(url); return null; });
    const { view } = mount("---\nsito: https://example.org/mostra\n---\n");
    expect(row(view, "sito").dataset.kind).toBe("url");
    const link = valueOf(view, "sito");
    expect(link.querySelector(".cm-fub-prop-url")!.textContent).toBe("https://example.org/mostra");
    expect(link.getAttribute("aria-label")).toBe("sito: https://example.org/mostra. Premi per aprire il sito");
    link.click();
    expect(opened).toEqual(["https://example.org/mostra"]);
    expect(row(view, "sito").querySelector("input")).toBeNull();
    row(view, "sito").querySelector<HTMLButtonElement>(".cm-fub-prop-url-edit")!.click();
    let input = row(view, "sito").querySelector<HTMLInputElement>("input.cm-fub-prop-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "https://example.org/sale";
    key(input, "Enter");
    expect(text(view)).toBe("---\nsito: https://example.org/sale\n---\n");
    key(valueOf(view, "sito"), "F2");
    input = row(view, "sito").querySelector<HTMLInputElement>("input.cm-fub-prop-input")!;
    expect(input.value).toBe("https://example.org/sale");
    key(input, "Escape");
    expect(opened).toHaveLength(1);
  });

  it("un indirizzo che il browser non apre resta un campo; in sola lettura il link è un link", () => {
    const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { sito: "url" } }));
    const { view } = mount("---\nsito: www.example.org\n---\n", { propertyTypes: () => types });
    expect(row(view, "sito").querySelector(".cm-fub-prop-url-edit")).toBeNull();
    valueOf(view, "sito").click();
    expect(row(view, "sito").querySelector("input")).not.toBeNull();
    const read = mount("---\nsito: https://example.org\n---\n", { readOnly: true });
    const anchor = row(read.view, "sito").querySelector<HTMLAnchorElement>("a.cm-fub-prop-url")!;
    expect(anchor.getAttribute("href")).toBe("https://example.org");
    expect(row(read.view, "sito").querySelector("button")).toBeNull();
  });
});

describe("i bordi", () => {
  it("il valore cambia mentre l'editor è aperto: non si scrive, ciò che si scriveva resta e lo si dice; la seconda conferma scrive", () => {
    const { view, notices } = mount("---\nluogo: Torino\n---\nTesto");
    valueOf(view, "luogo").click();
    const input = row(view, "luogo").querySelector<HTMLInputElement>("input")!;
    input.value = "Milano";
    // Un altro riquadro scrive la stessa voce.
    view.dispatch({ changes: { from: 11, to: 17, insert: "Genova" } });
    key(input, "Enter");
    expect(text(view)).toBe("---\nluogo: Genova\n---\nTesto");
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe("Milano");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(notices[notices.length - 1]).toContain("ora vale «Genova»");
    key(input, "Enter");
    expect(text(view)).toBe("---\nluogo: Milano\n---\nTesto");
  });

  it("nel riquadro della data il conflitto si dice dentro, e il riquadro resta", () => {
    const { view } = mount("---\nscadenza: 2026-03-02\n---\n");
    valueOf(view, "scadenza").click();
    view.dispatch({ changes: { from: 14, to: 24, insert: "2026-03-09" } });
    popover().querySelector<HTMLElement>("[data-day='2026-03-12']")!.click();
    expect(text(view)).toContain("scadenza: 2026-03-09");
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toContain("ora vale «2026-03-09»");
    popover().querySelector<HTMLElement>("[data-day='2026-03-12']")!.click();
    expect(text(view)).toContain("scadenza: 2026-03-12");
  });

  it("nell'elenco il conflitto non perde il gesto: la voce scelta resta, lo si dice, e Invio la scrive", () => {
    const { view } = mount("---\nl: [uno]\n---\n");
    valueOf(view, "l").click();
    view.dispatch({ changes: { from: 8, to: 11, insert: "tre" } });
    const input = popover().querySelector<HTMLInputElement>(".cm-fub-prop-list-input")!;
    input.value = "due";
    key(input, "Enter");
    expect(text(view)).toBe("---\nl: [tre]\n---\n");
    expect([...popover().querySelectorAll(".cm-fub-prop-chip")].map((chip) => chip.firstChild!.textContent)).toEqual(["uno", "due"]);
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toContain("ora vale «tre»");
    key(input, "Enter");
    expect(text(view)).toBe("---\nl: [uno, due]\n---\n");
    expect(popover().querySelector<HTMLElement>(".cm-fub-prop-note")!.hidden).toBe(true);
  });

  it("nelle persone il conflitto non perde il gesto: la spunta resta, e «Scrivi la mia» la scrive", async () => {
    const { view } = mount('---\np: ["[[Anna]]"]\n---\n', { searchPeople: async () => ["Anna", "Bruno"] });
    valueOf(view, "p").click();
    await Promise.resolve();
    await Promise.resolve();
    view.dispatch({ changes: { from: 11, to: 15, insert: "Carla" } });
    [...popover().querySelectorAll<HTMLElement>("[role=option]")].find((option) => option.textContent?.includes("Bruno"))!.click();
    expect(text(view)).toBe('---\np: ["[[Carla]]"]\n---\n');
    const bruno = [...popover().querySelectorAll<HTMLElement>("[role=option]")].find((option) => option.textContent?.includes("Bruno"))!;
    expect(bruno.getAttribute("aria-selected")).toBe("true");
    popover().querySelector<HTMLElement>(".cm-fub-prop-note-action")!.click();
    expect(text(view)).toBe('---\np: ["[[Anna]]", "[[Bruno]]"]\n---\n');
  });

  it("in sola lettura i valori si guardano e basta", () => {
    const { view } = mount("---\nluogo: Torino\nfatto: true\n---\n", { readOnly: true });
    expect(valueOf(view, "luogo").tagName).toBe("SPAN");
    expect(row(view, "luogo").querySelector("button")).toBeNull();
    expect(row(view, "fatto").querySelector("[role=checkbox]")).toBeNull();
  });

  it("una voce con un commento non la riscrive nessun editor: si apre lo YAML", () => {
    const { view } = mount("---\nfatto: true # controllato\n---\nTesto");
    valueOf(view, "fatto").click();
    expect(text(view)).toBe("---\nfatto: true # controllato\n---\nTesto");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("fatto: true # controllato");
  });
});
