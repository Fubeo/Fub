// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { openLifetime } from "../../ui/lifetime";
import {
  PARTS_PICKER_BELOW_MAX,
  PARTS_PICKER_BELOW_MIN,
  PARTS_PREVIEW_DELAY_MS,
  chosenKeys,
  filterSections,
  openPartsPicker,
  partsAction,
  partsPickerBelowHeight,
  partsPickerSide,
  partsSections,
  sectionHeading,
  type PartsPickerOptions,
} from "./parts-picker";

const RELAZIONE = [
  { level: 1, text: "Relazione" },
  { level: 2, text: "Scopo" },
  { level: 2, text: "Misure" },
  { level: 2, text: "Calcoli" },
  { level: 3, text: "Il periodo" },
  { level: 2, text: "Conclusioni" },
];

const BOARD = { left: 0, top: 0, width: 1200, height: 800 };
const CARD = { left: 300, top: 100, width: 240, height: 300 };

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("le sezioni di una nota", () => {
  it("un titolo per riga, col rientro del suo livello a partire dal più alto, e la chiave come Obsidian", () => {
    const sections = partsSections(RELAZIONE);
    expect(sections.map((section) => [section.text, section.depth, section.key, section.twin])).toEqual([
      ["Relazione", 1, "Relazione", false],
      ["Scopo", 2, "Scopo", false],
      ["Misure", 2, "Misure", false],
      ["Calcoli", 2, "Calcoli", false],
      ["Il periodo", 3, "Il periodo", false],
      ["Conclusioni", 2, "Conclusioni", false],
    ]);
    // Una nota che comincia dal livello 2 rientra da lì; oltre il terzo non rientra più.
    expect(partsSections([{ level: 2, text: "A" }, { level: 3, text: "B" }, { level: 6, text: "C" }]).map((section) => section.depth)).toEqual([1, 2, 3]);
  });

  it("due titoli uguali prendono il loro capitolo (`Capitolo#Titolo`); se anche così sono doppi, la riga lo dice", () => {
    const sections = partsSections([
      { level: 1, text: "Capitolo 1" },
      { level: 2, text: "Esercizi" },
      { level: 1, text: "Capitolo 2" },
      { level: 2, text: "Esercizi" },
      { level: 2, text: "Esercizi" },
      { level: 1, text: "Fine" },
    ]);
    expect(sections.map((section) => [section.key, section.twin])).toEqual([
      ["Capitolo 1", false],
      ["Capitolo 1#Esercizi", false],
      ["Capitolo 2", false],
      ["Capitolo 2#Esercizi", true],
      ["Capitolo 2#Esercizi", true],
      ["Fine", false],
    ]);
    expect(sectionHeading("Capitolo 2#Esercizi")).toBe("Esercizi");
  });

  it("un titolo vuoto non si sceglie, e una nota senza titoli non ha sezioni", () => {
    expect(partsSections([])).toEqual([]);
    expect(partsSections([{ level: 1, text: "  " }, { level: 2, text: "Uno" }]).map((section) => [section.text, section.index])).toEqual([["Uno", 1]]);
  });

  it("300 titoli diventano 300 righe, con le chiavi uniche", () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ level: 2, text: `Sezione ${index + 1}` }));
    const sections = partsSections(many);
    expect(sections).toHaveLength(300);
    expect(new Set(sections.map((section) => section.key)).size).toBe(300);
  });

  it("il filtro lascia i titoli che contengono la parola, senza badare alle maiuscole", () => {
    const sections = partsSections(RELAZIONE);
    expect(filterSections(sections, "  mIs ").map((section) => section.text)).toEqual(["Misure"]);
    expect(filterSections(sections, "")).toHaveLength(6);
    expect(filterSections(sections, "niente")).toEqual([]);
  });

  it("le chiavi da scrivere: una volta sola, nell'ordine della nota, solo quelle che la nota ha", () => {
    const sections = partsSections(RELAZIONE);
    expect(chosenKeys(sections, new Set(["Calcoli", "Scopo", "Sparita"]))).toEqual(["Scopo", "Calcoli"]);
  });

  it("il piede dice che cosa farà Invio", () => {
    expect(partsAction(0)).toBe(t("canvas.parts.put_note"));
    expect(partsAction(1)).toBe(t("canvas.parts.put_section"));
    expect(partsAction(2)).toBe(t("canvas.parts.put_sections", { n: 2 }));
    expect(partsAction(2)).toBe("Metti 2 sezioni");
  });

  it("accanto alla scheda se a destra c'è posto; sennò, e sempre in una finestra stretta, sotto", () => {
    expect(partsPickerSide(CARD, BOARD, false)).toBe("right");
    expect(partsPickerSide({ ...CARD, left: 700 }, BOARD, false)).toBe("below");
    expect(partsPickerSide(CARD, BOARD, true)).toBe("below");
    expect(partsPickerBelowHeight(CARD, BOARD)).toBe(PARTS_PICKER_BELOW_MAX);
    expect(partsPickerBelowHeight({ ...CARD, top: 500 }, BOARD)).toBe(PARTS_PICKER_BELOW_MIN);
  });
});

describe("il selettore", () => {
  function open(overrides: Partial<PartsPickerOptions> = {}, headings = RELAZIONE) {
    const lifetime = openLifetime();
    const put = vi.fn();
    const closed = vi.fn();
    const handle = openPartsPicker({
      path: "Note/Relazione.md",
      sections: partsSections(headings),
      chosen: [],
      place: () => ({ card: CARD, board: BOARD, narrow: false }),
      onPut: put,
      onClose: closed,
      lifetime,
      ...overrides,
    });
    const el = handle.element;
    const input = el.querySelector<HTMLInputElement>(".canvas-parts-field > input")!;
    const rows = () => [...el.querySelectorAll<HTMLElement>(".canvas-parts-row")];
    const row = (name: string) => rows().find((one) => one.textContent === name)!;
    const key = (name: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(event);
      return event;
    };
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const foot = () => el.querySelector(".kit-button")!.textContent;
    const count = () => el.querySelector(".canvas-parts-count")!.textContent;
    return { handle, el, input, rows, row, key, type, foot, count, put, closed, lifetime };
  }

  it("è un dialogo col titolo, il campo col fuoco, la lista a caselle e il piede", () => {
    const picker = open();
    expect(picker.el.classList.contains("kit-popover")).toBe(true);
    expect(picker.el.classList.contains("canvas-parts-picker")).toBe(true);
    expect(picker.el.getAttribute("role")).toBe("dialog");
    expect(picker.el.dataset.source).toBe("note");
    expect(picker.el.dataset.placement).toBe("right");
    const title = picker.el.querySelector(".canvas-parts-title")!;
    expect(picker.el.getAttribute("aria-labelledby")).toBe(title.id);
    expect(title.textContent).toBe("Parti di Relazione");
    expect(document.activeElement).toBe(picker.input);
    const list = picker.el.querySelector(".canvas-parts-list")!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    expect(list.getAttribute("aria-label")).toBe(t("canvas.parts.sections"));
    expect(picker.rows().map((row) => [row.getAttribute("role"), row.dataset.depth, row.getAttribute("aria-selected")])).toEqual([
      ["option", "1", "false"],
      ["option", "2", "false"],
      ["option", "2", "false"],
      ["option", "2", "false"],
      ["option", "3", "false"],
      ["option", "2", "false"],
    ]);
    expect(picker.rows()[0]!.querySelector(".canvas-parts-check")!.getAttribute("aria-hidden")).toBe("true");
    expect(picker.foot()).toBe("Metti tutta la nota");
    expect(picker.count()).toBe("0 di 6 scelte");
    expect(picker.el.querySelector(".canvas-parts-count")!.getAttribute("role")).toBe("status");
    expect(picker.el.querySelector(".canvas-parts-keys")!.textContent).toBe(t("canvas.parts.keys_note"));
    expect(picker.el.querySelector(".canvas-parts-close")!.getAttribute("aria-label")).toBe(t("canvas.parts.close"));
    picker.lifetime.close();
    expect(picker.handle.closed).toBe(true);
  });

  it("scrivere filtra i titoli; ciò che è spuntato resta spuntato", () => {
    const picker = open();
    picker.row("Misure").click();
    picker.type("cal");
    expect(picker.rows().map((row) => row.textContent)).toEqual(["Calcoli"]);
    picker.type("");
    expect(picker.row("Misure").getAttribute("aria-selected")).toBe("true");
    picker.type("niente");
    expect(picker.rows()).toEqual([]);
    // Senza righe Invio mette ciò che è scelto.
    picker.key("Enter");
    expect(picker.put).toHaveBeenCalledWith(["Misure"]);
  });

  it("↑ e ↓ muovono, Spazio spunta, Invio mette; il piede e il conto seguono", () => {
    const picker = open();
    const active = () => picker.rows().find((row) => row.hasAttribute("data-active"))?.textContent;
    expect(active()).toBe("Relazione");
    picker.key("ArrowDown");
    expect(active()).toBe("Scopo");
    expect(picker.input.getAttribute("aria-activedescendant")).toBe(picker.row("Scopo").id);
    expect(picker.key(" ").defaultPrevented).toBe(true);
    expect(picker.row("Scopo").getAttribute("aria-selected")).toBe("true");
    expect(picker.foot()).toBe("Metti la sezione");
    expect(picker.count()).toBe("1 di 6 scelte");
    picker.key("ArrowDown");
    picker.key("ArrowDown");
    picker.key(" ");
    expect(picker.foot()).toBe("Metti 2 sezioni");
    expect(picker.count()).toBe("2 di 6 scelte");
    // Spazio di nuovo toglie la spunta.
    picker.key(" ");
    picker.key(" ");
    picker.key("ArrowUp");
    expect(active()).toBe("Misure");
    picker.key("Enter");
    expect(picker.put).toHaveBeenCalledWith(["Scopo", "Calcoli"]);
    expect(picker.handle.closed).toBe(true);
    expect(picker.closed).not.toHaveBeenCalled();
  });

  it("dopo una parola scritta lo spazio scrive; le frecce lo riportano alla lista", () => {
    const picker = open();
    picker.type("il");
    expect(picker.key(" ").defaultPrevented).toBe(false);
    expect(picker.rows().some((row) => row.getAttribute("aria-selected") === "true")).toBe(false);
    picker.key("ArrowDown");
    expect(picker.key(" ").defaultPrevented).toBe(true);
    expect(picker.rows().filter((row) => row.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("un clic su una riga la spunta; il pulsante del piede mette", () => {
    const picker = open();
    picker.row("Calcoli").click();
    picker.row("Scopo").click();
    picker.el.querySelector<HTMLButtonElement>(".kit-button")!.click();
    expect(picker.put).toHaveBeenCalledWith(["Scopo", "Calcoli"]);
  });

  it("Esc e la crocetta chiudono senza mettere niente", () => {
    const esc = open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(esc.handle.closed).toBe(true);
    expect(esc.put).not.toHaveBeenCalled();
    expect(esc.closed).toHaveBeenCalledWith("escape");
    const cross = open();
    cross.el.querySelector<HTMLButtonElement>(".canvas-parts-close")!.click();
    expect(cross.put).not.toHaveBeenCalled();
    expect(cross.closed).toHaveBeenCalledWith("manual");
  });

  it("riaperto, le sezioni di adesso sono già spuntate e la prima è quella attiva", () => {
    const picker = open({ chosen: ["Calcoli", "Sparita"] });
    expect(picker.row("Calcoli").getAttribute("aria-selected")).toBe("true");
    expect(picker.row("Calcoli").hasAttribute("data-active")).toBe(true);
    expect(picker.count()).toBe("1 di 6 scelte");
  });

  it("un titolo doppio scelto: il piede avvisa che si vedrà il primo", () => {
    const picker = open({}, [{ level: 2, text: "Esercizi" }, { level: 2, text: "Esercizi" }, { level: 2, text: "Fine" }]);
    const hint = picker.el.querySelector<HTMLElement>(".canvas-parts-field-hint")!;
    expect(hint.hidden).toBe(true);
    picker.rows()[1]!.click();
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe(t("canvas.parts.twin_first", { name: "Esercizi" }));
    // Le due righe uguali sono la stessa scelta.
    expect(picker.rows()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(picker.count()).toBe("1 di 3 scelte");
  });

  it("l'anteprima mostra la sezione sotto il cursore, dopo una breve attesa; una resa tardiva si butta", async () => {
    vi.useFakeTimers();
    const resolvers: Array<() => void> = [];
    const show = vi.fn((_path: string, heading: string | null, host: HTMLElement) => {
      host.textContent = heading ?? "";
      return new Promise<void>((resolve) => resolvers.push(resolve));
    });
    const picker = open({ show });
    vi.advanceTimersByTime(PARTS_PREVIEW_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]!.slice(0, 2)).toEqual(["Note/Relazione.md", "Relazione"]);
    picker.key("ArrowDown");
    picker.key("ArrowDown");
    vi.advanceTimersByTime(PARTS_PREVIEW_DELAY_MS);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[1]![1]).toBe("Misure");
    resolvers[0]!();
    resolvers[1]!();
    await vi.runAllTimersAsync();
    const content = picker.el.querySelectorAll(".canvas-parts-preview > .canvas-card-note-content");
    expect(content).toHaveLength(1);
    expect(content[0]!.textContent).toBe("Misure");
  });

  it("dove a destra non c'è posto va sotto la scheda, largo come la lavagna, in una colonna", () => {
    const picker = open({ place: () => ({ card: CARD, board: BOARD, narrow: true }) });
    expect(picker.el.hasAttribute("data-narrow")).toBe(true);
    expect(picker.el.dataset.placement).toBe("bottom");
    expect(picker.el.style.width).toBe(`${BOARD.width - 16}px`);
    expect(picker.el.style.height).toBe(`${PARTS_PICKER_BELOW_MAX}px`);
  });
});
