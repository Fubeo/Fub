// @vitest-environment happy-dom
// Le forme come pannello, da solo: i riquadri nell'ordine del catalogo, la
// ricerca per nome e per altre parole nelle due lingue, senza badare agli
// accenti, la tastiera della griglia, l'inserimento col clic, con Invio e con
// Spazio, il trascinamento che passa all'editor, il dito tenuto fermo che
// solleva il riquadro, la sola lettura e il Esc del campo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { LONG_PRESS_MS, mountLongPressMenus } from "../../../ui/long-press";
import { drawStrings } from "../strings";
import { createLibraryPanel, matches, plain, type LibraryPanel } from "./library-panel";
import { LIBRARY, LIBRARY_GROUPS } from "./shape-library";

const IT = drawStrings.catalogFor("it");
const EN = drawStrings.catalogFor("en");

let host: HTMLElement;
let life: Lifetime;
let panel: LibraryPanel;
let calls: string[];

const SLOP = { pen: 3, mouse: 3, touch: 8 } as const;

function mount(editable = true): LibraryPanel {
  panel = createLibraryPanel(life, {
    onInsert: (id) => calls.push(`insert ${id}`),
    onDrag: (id, event) => calls.push(`drag ${id} ${event.clientX},${event.clientY}`),
    onLeave: () => calls.push("leave"),
    slop: SLOP,
  });
  host.append(panel.element);
  panel.update({ editable });
  return panel;
}

const search = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[type="search"]')!;
/// I riquadri, tutti, nell'ordine del documento.
const tiles = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>(".draw-library-tile")];
/// I riquadri che si vedono.
const shown = (): HTMLButtonElement[] => tiles().filter((tile) => !tile.hidden);
const names = (): string[] => shown().map((tile) => tile.getAttribute("aria-label")!);
const ids = (): string[] => shown().map((tile) => tile.dataset.shape!);
const tile = (id: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`.draw-library-tile[data-shape="${id}"]`)!;
const groups = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".draw-library-group")].filter((each) => !each.hidden);
const titles = (): string[] => groups().map((each) => each.querySelector("h3")!.textContent!);
const empty = (): HTMLElement => host.querySelector<HTMLElement>(".draw-library-empty")!;
const said = (): string => host.querySelector('[role="status"]')!.textContent!.trim();
const count = (): string => host.querySelector(".draw-library-count")!.textContent!;

function key(name: string, target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/// Scrive `text` nel campo, come chi digita.
function type(text: string): void {
  search().value = text;
  search().dispatchEvent(new Event("input", { bubbles: true }));
}

function pointer(type: string, target: Element, init: Partial<PointerEventInit> = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0, ...init });
  Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? "mouse", isPrimary: init.isPrimary ?? true });
  target.dispatchEvent(event);
  return event;
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
  vi.unstubAllGlobals();
});

describe("i riquadri", () => {
  it("sono 51, nell'ordine del catalogo, un `button` ciascuno col nome per etichetta e suggerimento", () => {
    mount();
    expect(tiles()).toHaveLength(51);
    expect(tiles().map((each) => each.dataset.shape)).toEqual(LIBRARY.map((shape) => shape.id));
    for (const [index, each] of tiles().entries()) {
      const name = IT[LIBRARY[index]!.name]!;
      expect(each.tagName).toBe("BUTTON");
      expect(each.getAttribute("type")).toBe("button");
      expect(each.getAttribute("aria-label")).toBe(name);
      expect(each.title).toBe(name);
    }
  });

  it("stanno in una raccolta per gruppo, col titolo, nell'ordine del pannello", () => {
    mount();
    expect(titles()).toEqual(["Forme di base", "Diagrammi di flusso", "Fumetti e richiami", "Frecce piene", "Scuola"]);
    expect(groups().map((each) => each.querySelectorAll(".draw-library-tile").length)).toEqual(LIBRARY_GROUPS.map((group) => LIBRARY.filter((shape) => shape.group === group).length));
    // Ogni griglia è un gruppo che il lettore dello schermo nomina col titolo.
    for (const section of groups()) {
      const grid = section.querySelector('[role="group"]')!;
      expect(document.getElementById(grid.getAttribute("aria-labelledby")!)!.textContent).toBe(section.querySelector("h3")!.textContent);
    }
  });

  it("hanno un'anteprima che si disegna una volta, di sola geometria, in `currentColor`, per gli occhi", () => {
    mount();
    for (const each of tiles()) {
      const preview = each.querySelector("svg")!;
      expect(preview.getAttribute("aria-hidden"), each.dataset.shape).toBe("true");
      expect(preview.getAttribute("viewBox"), each.dataset.shape).toMatch(/^0 0 [\d.]+ [\d.]+$/);
      // Sta nel riquadro di 40 × 32, nel rapporto di lati della forma.
      const [w, h] = [Number(preview.getAttribute("width")), Number(preview.getAttribute("height"))];
      expect(w, each.dataset.shape).toBeLessThanOrEqual(40.01);
      expect(h, each.dataset.shape).toBeLessThanOrEqual(32.01);
      expect(Math.max(w / 40, h / 32), each.dataset.shape).toBeGreaterThan(0.99);
      const parts = [...preview.children];
      expect(parts.length, each.dataset.shape).toBeGreaterThan(0);
      for (const part of parts) {
        expect(part.getAttribute("stroke")).toBe("currentColor");
        expect(part.getAttribute("fill")).toBe("none");
        expect(part.hasAttribute("fub:shape")).toBe(false);
        expect(part.tagName.toLowerCase()).not.toBe("text");
      }
    }
    const before = tile("basic-star").querySelector("svg");
    type("stella");
    type("");
    expect(tile("basic-star").querySelector("svg")).toBe(before);
  });

  it("disegnano le frecce dei due assi con un `d`, che un `path` sintetico non ha", () => {
    mount();
    const paths = [...tile("school-axes").querySelectorAll("path")];
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of paths) expect(path.getAttribute("d")).toMatch(/^M/);
  });

  it("hanno un solo riquadro nel giro di Tab, gli altri a -1", () => {
    mount();
    expect(tiles().filter((each) => each.tabIndex === 0)).toHaveLength(1);
    expect(tiles()[0]!.tabIndex).toBe(0);
    expect(tiles().filter((each) => each.tabIndex === -1)).toHaveLength(50);
  });

  it("passano la verifica dell'accessibilità", () => {
    mount();
    expect(formatIssues(checkAccessibility(host))).toBe("");
    type("zzzz");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("la ricerca", () => {
  it("ha un campo di ricerca con un nome, e il titolo e il conteggio del pannello", () => {
    mount();
    expect(search().type).toBe("search");
    const label = host.querySelector<HTMLLabelElement>(`label[for="${search().id}"]`)!;
    expect(label.textContent).toBe("Cerca una forma");
    expect(host.querySelector("h2")!.textContent).toBe("Forme");
    expect(count()).toBe("51 forme");
    expect(panel.element.getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
  });

  it("trova per pezzi di nome: «rett» i rettangoli", () => {
    mount();
    type("rett");
    expect(names()).toEqual(expect.arrayContaining(["Rettangolo", "Rettangolo arrotondato"]));
    expect(ids().every((id) => matches(LIBRARY.find((shape) => shape.id === id)!, ["rett"]))).toBe(true);
    expect(count()).toBe(`${shown().length} forme`);
    expect(names().length).toBeLessThan(51);
  });

  it("trova per le altre parole: «condizione» la decisione", () => {
    mount();
    type("condizione");
    expect(ids()).toContain("flow-decision");
    expect(names()).toContain("Decisione");
  });

  it("non bada alle maiuscole né agli accenti, da una parte e dall'altra", () => {
    mount();
    type("DECISIONE");
    const upper = ids();
    type("decisione");
    expect(ids()).toEqual(upper);
    expect(upper.length).toBeGreaterThan(0);
    // Un nome con l'accento si trova senza, e un campo con l'accento trova un nome senza.
    const accented = LIBRARY.find((shape) => /[àèéìòùÀÈÉÌÒÙ]/.test(`${IT[shape.name]} ${shape.words === undefined ? "" : IT[shape.words]}`));
    if (accented !== undefined) {
      const text = `${IT[accented.name]} ${accented.words === undefined ? "" : IT[accented.words]}`;
      const word = text.split(/[\s,]+/).find((each) => /[àèéìòù]/i.test(each))!;
      type(plain(word));
      expect(ids()).toContain(accented.id);
      type(word.toUpperCase());
      expect(ids()).toContain(accented.id);
    }
    type("RETTÀNGOLO");
    expect(names()).toContain("Rettangolo");
  });

  it("vuole tutte le parole del campo, in qualunque ordine", () => {
    mount();
    type("rettangolo arrotondato");
    expect(names()).toContain("Rettangolo arrotondato");
    expect(names()).not.toContain("Rettangolo");
    type("arrotondato rettangolo");
    expect(names()).toContain("Rettangolo arrotondato");
  });

  it("tiene le raccolte nel loro ordine e toglie quelle senza risultati", () => {
    mount();
    type("freccia");
    const titlesNow = titles();
    expect(titlesNow.length).toBeGreaterThan(0);
    expect(titlesNow.length).toBeLessThan(5);
    const order = LIBRARY_GROUPS.map((group) => IT[`draw.library.group.${group}` as keyof typeof IT]!);
    expect(titlesNow).toEqual(order.filter((title) => titlesNow.includes(title)));
    // I riquadri restano nell'ordine del catalogo.
    const positions = ids().map((id) => LIBRARY.findIndex((shape) => shape.id === id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Svuotato il campo, tornano tutte.
    type("");
    expect(titles()).toHaveLength(5);
    expect(shown()).toHaveLength(51);
  });

  it("senza risultati dice «Nessuna forma per «…»», e nessuna raccolta resta", () => {
    mount();
    type("  xyzzy ");
    expect(shown()).toHaveLength(0);
    expect(groups()).toHaveLength(0);
    expect(empty().hidden).toBe(false);
    expect(empty().textContent).toBe("Nessuna forma per «xyzzy».");
    expect(count()).toBe("0 forme");
    expect(said()).toBe("Nessuna forma per «xyzzy».");
    type("");
    expect(empty().hidden).toBe(true);
    expect(shown()).toHaveLength(51);
  });

  it("dice a chi ascolta quante forme restano", () => {
    mount();
    type("cerchio");
    expect(said()).toBe(`${shown().length === 1 ? "1 forma" : `${shown().length} forme`}`);
  });

  it("cerca anche in inglese, dopo `relabel()`, nel nome e nelle parole", () => {
    mount();
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(host.querySelector("h2")!.textContent).toBe("Shapes");
    expect(host.querySelector<HTMLLabelElement>(`label[for="${search().id}"]`)!.textContent).toBe("Search shapes");
    expect(titles()[0]).toBe("Basic shapes");
    expect(tile("basic-rectangle").getAttribute("aria-label")).toBe(EN["draw.library.basic-rectangle"]);
    expect(count()).toBe("51 shapes");
    type("rect");
    expect(ids()).toContain("basic-rectangle");
    // Una parola italiana non trova niente, in inglese.
    type("condizione");
    expect(shown()).toHaveLength(0);
    expect(empty().textContent).toBe("No shapes for “condizione”.");
    // Le altre parole inglesi.
    const decision = LIBRARY.find((shape) => shape.id === "flow-decision")!;
    const word = EN[decision.words!]!.split(",")[0]!.trim();
    type(word);
    expect(ids()).toContain("flow-decision");
  });

  it("trova ogni forma col suo nome intero, in italiano e in inglese", () => {
    mount();
    for (const language of ["it-IT", "en-GB"]) {
      vi.stubGlobal("navigator", { language });
      panel.relabel();
      const catalog = language === "it-IT" ? IT : EN;
      for (const shape of LIBRARY) {
        type(catalog[shape.name]!);
        expect(ids(), `${language} ${shape.id}`).toContain(shape.id);
      }
      type("");
    }
  });

  it("tiene il riquadro attivo se resta, e se sparisce passa al primo che c'è", () => {
    mount();
    tile("flow-decision").focus();
    key("ArrowRight", tile("flow-decision"));
    const here = tiles().find((each) => each.tabIndex === 0)!;
    type("freccia");
    const active = tiles().filter((each) => each.tabIndex === 0);
    expect(active).toHaveLength(1);
    expect(active[0]!.hidden).toBe(false);
    expect(here.hidden).toBe(true);
    expect(active[0]).toBe(shown()[0]);
  });
});

describe("Esc nel campo", () => {
  it("con del testo lo svuota e resta nel pannello", () => {
    mount();
    search().focus();
    type("rett");
    const event = key("Escape", search());
    expect(event.defaultPrevented).toBe(true);
    expect(search().value).toBe("");
    expect(shown()).toHaveLength(51);
    expect(calls).toEqual([]);
    expect(document.activeElement).toBe(search());
    expect(said()).toBe("51 forme");
  });

  it("a campo vuoto esce dal pannello", () => {
    mount();
    search().focus();
    key("Escape", search());
    expect(calls).toEqual(["leave"]);
  });

  it("da un riquadro esce, anche se il campo ha del testo", () => {
    mount();
    type("rett");
    key("Escape", shown()[0]!);
    expect(calls).toEqual(["leave"]);
    expect(search().value).toBe("rett");
  });

  it("l'editor non vede il tasto", () => {
    mount();
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    key("Escape", search());
    key("ArrowDown", search());
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("la tastiera della griglia", () => {
  it("dal campo, ↓ porta al primo riquadro", () => {
    mount();
    search().focus();
    const event = key("ArrowDown", search());
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tiles()[0]);
    // Cercando, al primo che si vede.
    type("cerchio");
    search().focus();
    key("ArrowDown", search());
    expect(document.activeElement).toBe(shown()[0]);
  });

  it("le frecce passano da un riquadro all'altro, anche da una raccolta alla successiva", () => {
    mount();
    tiles()[0]!.focus();
    key("ArrowRight", tiles()[0]!);
    expect(document.activeElement).toBe(tiles()[1]);
    expect(tiles()[1]!.tabIndex).toBe(0);
    expect(tiles()[0]!.tabIndex).toBe(-1);
    key("ArrowLeft", tiles()[1]!);
    expect(document.activeElement).toBe(tiles()[0]);
    // L'ultimo della prima raccolta, → : il primo della seconda.
    const lastBasic = tile("basic-heart");
    const firstFlow = tile("flow-process");
    lastBasic.focus();
    key("ArrowRight", lastBasic);
    expect(document.activeElement).toBe(firstFlow);
    key("ArrowLeft", firstFlow);
    expect(document.activeElement).toBe(lastBasic);
    // ↓ senza una disposizione sullo schermo passa al riquadro vicino.
    key("ArrowDown", lastBasic);
    expect(document.activeElement).toBe(firstFlow);
    key("ArrowUp", firstFlow);
    expect(document.activeElement).toBe(lastBasic);
  });

  it("si fermano ai capi della griglia", () => {
    mount();
    tiles()[0]!.focus();
    key("ArrowLeft", tiles()[0]!);
    expect(document.activeElement).toBe(tiles()[0]);
    const last = tiles()[50]!;
    last.focus();
    key("ArrowRight", last);
    expect(document.activeElement).toBe(last);
    key("ArrowDown", last);
    expect(document.activeElement).toBe(last);
  });

  it("↑ sul primo riquadro torna al campo", () => {
    mount();
    tiles()[0]!.focus();
    key("ArrowUp", tiles()[0]!);
    expect(document.activeElement).toBe(search());
  });

  it("Home e Fine vanno al primo e all'ultimo riquadro che si vedono", () => {
    mount();
    tile("flow-data").focus();
    key("End", tile("flow-data"));
    expect(document.activeElement).toBe(tiles()[50]);
    key("Home", tiles()[50]!);
    expect(document.activeElement).toBe(tiles()[0]);
    type("freccia");
    const list = shown();
    list[2]!.focus();
    key("End", list[2]!);
    expect(document.activeElement).toBe(list[list.length - 1]);
    key("Home", list[list.length - 1]!);
    expect(document.activeElement).toBe(list[0]);
  });

  it("Invio e Spazio inseriscono la forma, e il fuoco resta lì", () => {
    mount();
    tile("flow-decision").focus();
    const enter = key("Enter", tile("flow-decision"));
    expect(enter.defaultPrevented).toBe(true);
    expect(calls).toEqual(["insert flow-decision"]);
    expect(document.activeElement).toBe(tile("flow-decision"));
    key(" ", tile("flow-decision"));
    expect(calls).toEqual(["insert flow-decision", "insert flow-decision"]);
    // Più forme di fila: ci si sposta e si inserisce.
    key("ArrowRight", tile("flow-decision"));
    key("Enter", tile("flow-data"));
    expect(calls[2]).toBe("insert flow-data");
    expect(document.activeElement).toBe(tile("flow-data"));
  });

  it("non lascia passare all'editor i tasti che usa", () => {
    mount();
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    tile("basic-circle").focus();
    for (const name of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "]) key(name, tile("basic-circle"));
    expect(seen).not.toHaveBeenCalled();
  });

  it("lascia passare gli altri tasti, e quelli con Ctrl, Alt o ⌘", () => {
    mount();
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    key("r", tile("basic-circle"));
    key("ArrowRight", tile("basic-circle"), { ctrlKey: true });
    key("Enter", tile("basic-circle"), { metaKey: true });
    expect(seen).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([]);
  });

  it("Esc da un riquadro torna al foglio", () => {
    mount();
    key("Escape", tile("basic-circle"));
    expect(calls).toEqual(["leave"]);
  });

  it("il rilascio di Spazio o Invio non fa un secondo inserimento", () => {
    mount();
    const up = new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true });
    tile("basic-circle").dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("il puntatore", () => {
  it("un clic inserisce la forma", () => {
    mount();
    const target = tile("basic-hexagon");
    pointer("pointerdown", target, { clientX: 10, clientY: 10 });
    pointer("pointerup", target, { clientX: 10, clientY: 10 });
    target.click();
    expect(calls).toEqual(["insert basic-hexagon"]);
    expect(target.tabIndex).toBe(0);
  });

  it("un clic con un lettore dello schermo, senza puntatore, inserisce", () => {
    mount();
    tile("basic-circle").click();
    expect(calls).toEqual(["insert basic-circle"]);
  });

  it("un movimento sotto la soglia resta un clic", () => {
    mount();
    const target = tile("basic-hexagon");
    pointer("pointerdown", target, { clientX: 10, clientY: 10 });
    pointer("pointermove", target, { clientX: 12, clientY: 11 });
    pointer("pointerup", target, { clientX: 12, clientY: 11 });
    target.click();
    expect(calls).toEqual(["insert basic-hexagon"]);
  });

  it("oltre la soglia comincia un trascinamento e passa all'editor, una volta, senza inserire", () => {
    mount();
    const target = tile("basic-hexagon");
    pointer("pointerdown", target, { clientX: 10, clientY: 10 });
    pointer("pointermove", target, { clientX: 11, clientY: 10 });
    expect(calls).toEqual([]);
    pointer("pointermove", target, { clientX: 20, clientY: 10 });
    pointer("pointermove", target, { clientX: 40, clientY: 10 });
    pointer("pointerup", target, { clientX: 40, clientY: 10 });
    // Il clic che il browser manda al rilascio non inserisce.
    target.click();
    expect(calls).toEqual(["drag basic-hexagon 20,10"]);
    // Il clic seguente, di un'altra pressione, sì.
    pointer("pointerdown", target, { clientX: 10, clientY: 10 });
    target.click();
    expect(calls).toEqual(["drag basic-hexagon 20,10", "insert basic-hexagon"]);
  });

  it("la soglia è quella dei gesti dell'editor, e dipende dal puntatore", () => {
    mount();
    const target = tile("basic-circle");
    // Un dito ha 8 px: 5 non bastano.
    pointer("pointerdown", target, { clientX: 0, clientY: 0, pointerType: "touch" });
    pointer("pointermove", target, { clientX: 5, clientY: 0, pointerType: "touch" });
    expect(calls).toEqual([]);
    pointer("pointermove", target, { clientX: 9, clientY: 0, pointerType: "touch" });
    expect(calls).toEqual(["drag basic-circle 9,0"]);
    pointer("pointerup", target, { pointerType: "touch" });
    // Una penna ne ha 3.
    pointer("pointerdown", target, { clientX: 0, clientY: 0, pointerType: "pen" });
    pointer("pointermove", target, { clientX: 4, clientY: 0, pointerType: "pen" });
    expect(calls).toHaveLength(2);
  });

  it("ignora un puntatore che non è il principale e un tasto che non è il sinistro", () => {
    mount();
    const target = tile("basic-circle");
    pointer("pointerdown", target, { clientX: 0, clientY: 0, button: 2 });
    pointer("pointermove", target, { clientX: 40, clientY: 0 });
    pointer("pointerdown", target, { clientX: 0, clientY: 0, isPrimary: false, pointerId: 7 });
    pointer("pointermove", target, { clientX: 40, clientY: 0, pointerId: 7 });
    expect(calls).toEqual([]);
  });

  it("annullato il puntatore, il trascinamento non comincia", () => {
    mount();
    const target = tile("basic-circle");
    pointer("pointerdown", target, { clientX: 0, clientY: 0 });
    pointer("pointercancel", target);
    pointer("pointermove", target, { clientX: 40, clientY: 0 });
    expect(calls).toEqual([]);
  });

  it("prende il puntatore sul riquadro, per riceverlo anche fuori dal pannello", () => {
    mount();
    const target = tile("basic-circle");
    const capture = vi.fn();
    target.setPointerCapture = capture;
    pointer("pointerdown", target, { pointerId: 5 });
    expect(capture).toHaveBeenCalledWith(5);
  });
});

describe("il dito tenuto fermo", () => {
  /// Quanto il dito resta fermo prima che il riquadro si sollevi: `HOLD_MS`.
  const HOLD = 400;
  const down = (target: Element, x = 100, y = 100, kind = "touch"): void => {
    pointer("pointerdown", target, { clientX: x, clientY: y, pointerType: kind });
  };
  const move = (target: Element, x: number, y: number, kind = "touch"): void => {
    pointer("pointermove", target, { clientX: x, clientY: y, pointerType: kind });
  };
  const up = (target: Element, kind = "touch"): void => {
    pointer("pointerup", target, { pointerType: kind });
  };
  /// Un `touchmove` che si può annullare, e se qualcuno lo ha annullato.
  const touchmove = (target: Element): boolean => {
    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dopo 400 ms il riquadro si solleva, e prima no; alzato il dito, torna al suo posto", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD - 1);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(target.hasAttribute("data-lifted")).toBe(true);
    expect(calls).toEqual([]);
    up(target);
    expect(target.hasAttribute("data-lifted")).toBe(false);
  });

  it("un riquadro sollevato e lasciato senza muoverlo non inserisce, e il tocco dopo sì", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD);
    up(target);
    target.click();
    expect(calls).toEqual([]);
    // Il tocco successivo, breve, è un tocco normale.
    down(target);
    up(target);
    target.click();
    expect(calls).toEqual(["insert basic-circle"]);
  });

  it("un tocco breve inserisce, senza sollevare niente", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD - 100);
    up(target);
    vi.advanceTimersByTime(HOLD);
    target.click();
    expect(calls).toEqual(["insert basic-circle"]);
    expect(target.hasAttribute("data-lifted")).toBe(false);
  });

  it.each([
    ["in su", 0, -30],
    ["in giù", 0, 30],
    ["a sinistra", -30, 0],
    ["a destra", 30, 0],
    ["in diagonale", 20, -20],
  ])("sollevato, il primo movimento oltre la soglia %s trascina, una volta", (_name, dx, dy) => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD);
    // Sotto la soglia del dito (8 px) il riquadro resta sollevato e fermo.
    move(target, 100 + Math.sign(dx) * 3, 100 + Math.sign(dy) * 3);
    expect(calls).toEqual([]);
    move(target, 100 + dx, 100 + dy);
    move(target, 100 + 2 * dx, 100 + 2 * dy);
    up(target);
    target.click();
    expect(calls).toEqual([`drag basic-circle ${100 + dx},${100 + dy}`]);
  });

  it("sollevato, tiene il riquadro finché il dito non si alza, e l'elenco non scorre", () => {
    mount();
    const target = tile("basic-circle");
    // Prima, un dito che si muove scorre: nessuno lo ferma.
    down(target);
    expect(touchmove(target)).toBe(false);
    vi.advanceTimersByTime(HOLD);
    expect(touchmove(target)).toBe(true);
    move(target, 100, 40);
    // Anche trascinato, e fuori dal pannello: il `touchmove` parte ancora dal riquadro.
    expect(touchmove(target)).toBe(true);
    up(target);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    expect(touchmove(target)).toBe(false);
  });

  it("un `touchmove` non annullabile non si prova ad annullare", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD);
    const event = new Event("touchmove", { bubbles: true, cancelable: false });
    const prevent = vi.spyOn(event, "preventDefault");
    target.dispatchEvent(event);
    expect(prevent).not.toHaveBeenCalled();
  });

  it.each([
    ["in su", 0, -30],
    ["in giù", 0, 30],
    ["in su, un po' storto", 10, -30],
  ])("mosso prima della tenuta %s, scorre: niente trascinamento, e poi niente sollevamento", (_name, dx, dy) => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(100);
    move(target, 100 + dx, 100 + dy);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(2 * HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    // La pressione è finita: un altro movimento, anche di lato, non la riprende.
    move(target, 200, 100 + dy);
    expect(calls).toEqual([]);
    expect(touchmove(target)).toBe(false);
  });

  it("mosso prima della tenuta di lato, trascina come prima, e poi non si solleva", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(100);
    move(target, 130, 105);
    expect(calls).toEqual(["drag basic-circle 130,105"]);
    vi.advanceTimersByTime(2 * HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    up(target);
    target.click();
    expect(calls).toHaveLength(1);
  });

  it("un movimento sotto la soglia prima della tenuta non la ferma", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(100);
    move(target, 100, 95);
    vi.advanceTimersByTime(HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(true);
  });

  it("il puntatore annullato durante la tenuta non fa niente", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD - 100);
    pointer("pointercancel", target, { pointerType: "touch" });
    vi.advanceTimersByTime(HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    move(target, 100, 20);
    expect(calls).toEqual([]);
    expect(touchmove(target)).toBe(false);
  });

  it("annullato dopo il sollevamento, il riquadro torna giù e un clic dopo, senza puntatore, inserisce", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(true);
    pointer("pointercancel", target, { pointerType: "touch" });
    expect(target.hasAttribute("data-lifted")).toBe(false);
    expect(touchmove(target)).toBe(false);
    expect(calls).toEqual([]);
    target.click();
    expect(calls).toEqual(["insert basic-circle"]);
  });

  it("un'altra pressione prende il posto della prima: solo l'ultima si solleva", () => {
    mount();
    const first = tile("basic-circle");
    const second = tile("basic-hexagon");
    down(first);
    vi.advanceTimersByTime(HOLD / 2);
    up(first);
    down(second);
    vi.advanceTimersByTime(HOLD / 2);
    expect(first.hasAttribute("data-lifted")).toBe(false);
    expect(second.hasAttribute("data-lifted")).toBe(false);
    vi.advanceTimersByTime(HOLD / 2);
    expect(second.hasAttribute("data-lifted")).toBe(true);
  });

  it("il mouse non cambia: niente sollevamento, un clic inserisce, ogni movimento oltre la soglia trascina", () => {
    mount();
    const target = tile("basic-circle");
    down(target, 100, 100, "mouse");
    vi.advanceTimersByTime(5 * HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    up(target, "mouse");
    target.click();
    expect(calls).toEqual(["insert basic-circle"]);
    // In su, come in qualunque direzione: subito.
    down(target, 100, 100, "mouse");
    move(target, 100, 60, "mouse");
    expect(calls).toEqual(["insert basic-circle", "drag basic-circle 100,60"]);
    expect(touchmove(target)).toBe(false);
  });

  it("la penna non cambia: niente sollevamento, e trascina subito anche in su", () => {
    mount();
    const target = tile("basic-circle");
    down(target, 100, 100, "pen");
    vi.advanceTimersByTime(5 * HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    move(target, 100, 80, "pen");
    expect(calls).toEqual(["drag basic-circle 100,80"]);
  });

  it("in sola lettura il dito non solleva niente, e il clic dice perché", () => {
    mount(false);
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(2 * HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
    up(target);
    target.click();
    expect(calls).toEqual([]);
    expect(said()).toContain(IT["draw.reason.read_only"]);
  });

  it("chiuso il pannello durante la tenuta, il riquadro non si solleva più", () => {
    mount();
    const target = tile("basic-circle");
    down(target);
    vi.advanceTimersByTime(HOLD - 100);
    life.close();
    vi.advanceTimersByTime(HOLD);
    expect(target.hasAttribute("data-lifted")).toBe(false);
  });

  describe("e il menu della pressione lunga", () => {
    let menus: MouseEvent[];
    let reached: MouseEvent[];

    beforeEach(() => {
      menus = [];
      reached = [];
      mountLongPressMenus(life);
      // Come un menu: ascolta in alto, nel documento, ciò che sale dal riquadro.
      life.listen(document, "contextmenu", (event) => reached.push(event));
    });

    it("il ponte non lo apre: l'evento è annullato e non sale, e il rilascio non inserisce", () => {
      mount();
      const target = tile("basic-circle");
      target.addEventListener("contextmenu", (event) => menus.push(event));
      down(target);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(menus).toHaveLength(1);
      expect(menus[0]!.defaultPrevented).toBe(true);
      expect(reached).toEqual([]);
      up(target);
      target.click();
      expect(calls).toEqual([]);
      expect(target.hasAttribute("data-lifted")).toBe(false);
      // Il tocco dopo è un tocco: il menu del documento sarebbe tornato possibile.
      down(target);
      up(target);
      target.click();
      expect(calls).toEqual(["insert basic-circle"]);
    });

    it("lasciato prima del ponte, il rilascio non inserisce e il ponte non scatta più", () => {
      mount();
      const target = tile("basic-circle");
      down(target);
      vi.advanceTimersByTime(HOLD + 20);
      up(target);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      target.click();
      expect(calls).toEqual([]);
      expect(reached).toEqual([]);
    });

    it("il menu che il sistema manda da sé a un riquadro tenuto è annullato e non sale", () => {
      mount();
      const target = tile("basic-circle");
      target.addEventListener("contextmenu", (event) => menus.push(event));
      down(target);
      vi.advanceTimersByTime(HOLD);
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(menus[0]!.defaultPrevented).toBe(true);
      expect(reached).toEqual([]);
    });

    it("il tasto destro del mouse non è toccato", () => {
      mount();
      const target = tile("basic-circle");
      target.addEventListener("contextmenu", (event) => menus.push(event));
      down(target, 100, 100, "mouse");
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(menus[0]!.defaultPrevented).toBe(false);
      expect(reached).toHaveLength(1);
    });

    it("un trascinamento di lato cominciato di poco e poi fermo non apre il menu", () => {
      mount();
      const target = tile("basic-circle");
      target.addEventListener("contextmenu", (event) => menus.push(event));
      down(target);
      // Oltre la soglia del trascinamento, sotto quella del ponte.
      move(target, 109, 100);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(calls).toEqual(["drag basic-circle 109,100"]);
      expect(menus).toHaveLength(1);
      expect(menus[0]!.defaultPrevented).toBe(true);
      expect(reached).toEqual([]);
      up(target);
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(reached).toHaveLength(1);
    });

    it("sollevato e trascinato, il ponte si fa da parte da solo: il dito si è mosso", () => {
      mount();
      const target = tile("basic-circle");
      down(target);
      vi.advanceTimersByTime(HOLD);
      move(target, 100, 60);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(reached).toEqual([]);
      expect(calls).toEqual(["drag basic-circle 100,60"]);
    });
  });
});

describe("la sola lettura", () => {
  it("lascia i riquadri `aria-disabled`, non `disabled`, e raggiungibili", () => {
    mount(false);
    for (const each of tiles()) {
      expect(each.getAttribute("aria-disabled")).toBe("true");
      expect(each.disabled).toBe(false);
    }
    expect(tiles().filter((each) => each.tabIndex === 0)).toHaveLength(1);
  });

  it("non inserisce, e dice perché", () => {
    mount(false);
    tile("basic-circle").focus();
    key("Enter", tile("basic-circle"));
    expect(calls).toEqual([]);
    expect(said()).toBe("Modifica non applicata: il disegno è in sola lettura.");
    tile("basic-circle").click();
    expect(calls).toEqual([]);
  });

  it("non comincia nessun trascinamento", () => {
    mount(false);
    const target = tile("basic-circle");
    pointer("pointerdown", target, { clientX: 0, clientY: 0 });
    pointer("pointermove", target, { clientX: 40, clientY: 0 });
    expect(calls).toEqual([]);
  });

  it("si naviga e si cerca come sempre, e il suggerimento lo dice", () => {
    mount(false);
    type("cerchio");
    expect(ids()).toContain("basic-circle");
    key("ArrowRight", shown()[0]!);
    expect(document.getElementById(search().getAttribute("aria-describedby")!)!.textContent).toBe("Il disegno è in sola lettura: le forme si guardano, ma non si inseriscono.");
  });

  it("torna a inserire quando il disegno si può cambiare", () => {
    mount(false);
    panel.update({ editable: true });
    for (const each of tiles()) expect(each.hasAttribute("aria-disabled")).toBe(false);
    key("Enter", tile("basic-circle"));
    expect(calls).toEqual(["insert basic-circle"]);
    expect(document.getElementById(search().getAttribute("aria-describedby")!)!.textContent).toContain("Invio o Spazio");
  });

  it("passa la verifica dell'accessibilità", () => {
    mount(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("il fuoco", () => {
  it("`focus()` va al campo di ricerca", () => {
    mount();
    panel.focus();
    expect(document.activeElement).toBe(search());
  });
});

describe("plain e matches", () => {
  it("tolgono maiuscole e accenti", () => {
    expect(plain("PÀ èÙ’")).toBe("pa eu'");
    expect(plain("Più")).toBe(plain("piu"));
  });

  it("senza pezzi corrispondono tutte", () => {
    expect(LIBRARY.every((shape) => matches(shape, []))).toBe(true);
  });
});
