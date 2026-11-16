// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(popover().querySelector(".cm-fub-prop-note")!.textContent).toContain("Non è una data");
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

  it("la data scritta a mano: ISO, all'italiana, con l'ora", () => {
    expect(parseDateInput("2026-03-20")).toEqual({ date: "2026-03-20", time: null });
    expect(parseDateInput("20/3/2026")).toEqual({ date: "2026-03-20", time: null });
    expect(parseDateInput("20.3.26")).toEqual({ date: "2026-03-20", time: null });
    expect(parseDateInput("2026-03-20 9:05")).toEqual({ date: "2026-03-20", time: "09:05" });
    expect(parseDateInput("30/2/2026")).toBeNull();
    expect(parseDateInput("domani")).toBeNull();
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

  it("un valore fuori dalle opzioni, o senza opzioni, resta testo; il clic lo scrive come prima", () => {
    const { view } = mount("---\nstato: Boh\nfase: Prima\n---\n", { propertyTypes: registry });
    expect(valueOf(view, "stato").querySelector(".cm-fub-prop-opt")).toBeNull();
    expect(valueOf(view, "stato").textContent).toBe("Boh");
    expect(valueOf(view, "fase").querySelector(".cm-fub-prop-opt")).toBeNull();
    valueOf(view, "stato").click();
    expect(row(view, "stato").querySelector("input")!.value).toBe("Boh");
  });

  it("in sola lettura (e in Lettura) la pastiglia resta", () => {
    const { view } = mount("---\nstato: In corso\n---\n", { propertyTypes: registry, readOnly: true });
    expect(row(view, "stato").querySelector(".cm-fub-page-prop-value .cm-fub-prop-opt")!.textContent).toBe("In corso");
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
