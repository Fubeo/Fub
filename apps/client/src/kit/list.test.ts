// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../moto";
import { checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { TYPEAHEAD_MS, createList, type ListOptions } from "./list";
import { measure, pointer, press } from "./testing";

interface Fruit {
  id: string;
  name: string;
  off?: boolean;
}

const FRUITS: Fruit[] = [
  { id: "a", name: "Albicocca" },
  { id: "b", name: "Banana" },
  { id: "c", name: "Ciliegia" },
  { id: "d", name: "Cocomero" },
  { id: "e", name: "Dattero" },
];

let life: Lifetime;
let container: HTMLElement;
let activated: string[];
let highlighted: (string | null)[];

function list(extra: Partial<ListOptions<Fruit>> = {}) {
  return createList<Fruit>({
    container,
    role: "listbox",
    items: FRUITS,
    key: (item) => item.id,
    render: (item, row) => {
      row.textContent = item.name;
    },
    disabled: (item) => item.off === true,
    onActivate: (item) => activated.push(item.id),
    onHighlight: (item) => highlighted.push(item?.id ?? null),
    lifetime: life,
    ...extra,
  });
}

const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(".kit-list-item")];
const activeRow = (): HTMLElement | null => container.querySelector<HTMLElement>("[data-active]");
const highlight = (): HTMLElement => container.querySelector<HTMLElement>(".kit-list-highlight")!;

/// Dà alle righe la geometria di una colonna: 28 px l'una, larghe 200.
function layOut(): void {
  rows().forEach((row, index) => measure(row, { left: 4, top: 4 + index * 28, width: 200, height: 28 }));
}

beforeEach(() => {
  life = openLifetime();
  container = document.createElement("div");
  container.setAttribute("aria-label", "Frutti");
  document.body.append(container);
  activated = [];
  highlighted = [];
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
  setMotionDriver(null);
  setMotionPreference("system");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("la forma", () => {
  it("è un listbox di opzioni, con la prima attiva e detta al padrone del fuoco", () => {
    list();
    expect(container.getAttribute("role")).toBe("listbox");
    expect(container.classList.contains("kit-list")).toBe(true);
    expect(container.tabIndex).toBe(0);
    expect(rows().map((row) => row.getAttribute("role"))).toEqual(Array(5).fill("option"));
    expect(rows().map((row) => row.textContent)).toEqual(FRUITS.map((fruit) => fruit.name));
    expect(activeRow()).toBe(rows()[0]);
    expect(container.getAttribute("aria-activedescendant")).toBe(rows()[0].id);
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
    // Alla creazione non avvisa: chi vuole sapere chiede `active()`.
    expect(highlighted).toEqual([]);
  });

  it("supera il controllo di accessibilità della shell", () => {
    list();
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("un menu ha voci di menu, nessuna attiva finché non ci si muove, e gira", () => {
    list({ role: "menu" });
    expect(container.getAttribute("role")).toBe("menu");
    expect(rows().every((row) => row.getAttribute("role") === "menuitem")).toBe(true);
    expect(rows().every((row) => !row.hasAttribute("aria-selected"))).toBe(true);
    expect(activeRow()).toBeNull();
    expect(container.hasAttribute("aria-activedescendant")).toBe(false);
    press(container, "ArrowUp");
    expect(activeRow()).toBe(rows()[4]);
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[0]);
  });

  it("dice quali voci sono scelte quando chi la usa lo sa", () => {
    list({ selected: (item) => item.id === "c" });
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    press(container, "ArrowDown");
    expect(rows()[2].getAttribute("aria-selected")).toBe("true");
    expect(rows()[1].getAttribute("aria-selected")).toBe("false");
  });

  it("segna la scelta dichiarata per la pelle, e la riga attiva non la sposta", () => {
    let chosen = "c";
    const made = list({ selected: (item) => item.id === chosen });
    const marked = (): string[] => rows().filter((row) => "selected" in row.dataset).map((row) => row.textContent!);
    expect(marked()).toEqual(["Ciliegia"]);
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[1]);
    expect(marked()).toEqual(["Ciliegia"]);
    // La scelta cambia quando chi usa la lista la rilegge.
    chosen = "a";
    made.setItems(FRUITS);
    expect(marked()).toEqual(["Albicocca"]);
    expect(rows()[2].getAttribute("aria-selected")).toBe("false");
  });

  it("senza una scelta dichiarata non c'è niente da segnare: è scelta la riga attiva", () => {
    list();
    expect(rows().some((row) => "selected" in row.dataset)).toBe(false);
  });
});

describe("il fuoco di un campo", () => {
  let field: HTMLInputElement;

  beforeEach(() => {
    field = document.createElement("input");
    field.setAttribute("aria-label", "Cerca");
    document.body.prepend(field);
    field.focus();
  });

  it("resta nel campo: la riga attiva si dice con aria-activedescendant", () => {
    list({ owner: field });
    expect(field.getAttribute("aria-controls")).toBe(container.id);
    expect(container.hasAttribute("tabindex")).toBe(false);
    press(field, "ArrowDown");
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-activedescendant")).toBe(rows()[1].id);
    expect(container.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("le frecce si consumano, Inizio e Fine restano al cursore", () => {
    list({ owner: field });
    expect(press(field, "ArrowDown").defaultPrevented).toBe(true);
    expect(press(field, "End").defaultPrevented).toBe(false);
    expect(press(field, "Home").defaultPrevented).toBe(false);
    expect(activeRow()).toBe(rows()[1]);
  });

  it("i caratteri e lo spazio scrivono: niente ricerca a battuta, niente attivazione", () => {
    list({ owner: field, typeahead: (item) => item.name });
    expect(press(field, "d").defaultPrevented).toBe(false);
    expect(press(field, " ").defaultPrevented).toBe(false);
    expect(activeRow()).toBe(rows()[0]);
    expect(activated).toEqual([]);
  });

  it("Invio attiva la riga attiva", () => {
    list({ owner: field });
    press(field, "ArrowDown");
    expect(press(field, "Enter").defaultPrevented).toBe(true);
    expect(activated).toEqual(["b"]);
  });

  it("premere una riga non toglie il fuoco al campo", () => {
    list({ owner: field });
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    rows()[2].dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    rows()[2].click();
    expect(activated).toEqual(["c"]);
    expect(document.activeElement).toBe(field);
  });

  it("non tocca un aria-controls che il campo aveva già", () => {
    field.setAttribute("aria-controls", "altro");
    list({ owner: field });
    life.close();
    expect(field.getAttribute("aria-controls")).toBe("altro");
  });

  it("mentre si compone un carattere i tasti non sono suoi", () => {
    list({ owner: field });
    expect(press(field, "ArrowDown", { isComposing: true }).defaultPrevented).toBe(false);
    expect(press(field, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(activeRow()).toBe(rows()[0]);
    expect(activated).toEqual([]);
  });
});

describe("la tastiera", () => {
  it("frecce, Inizio e Fine si muovono fra le righe e avvisano", () => {
    list();
    press(container, "ArrowDown");
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[2]);
    press(container, "ArrowUp");
    expect(activeRow()).toBe(rows()[1]);
    press(container, "End");
    expect(activeRow()).toBe(rows()[4]);
    press(container, "Home");
    expect(activeRow()).toBe(rows()[0]);
    expect(highlighted).toEqual(["b", "c", "b", "e", "a"]);
  });

  it("un listbox non gira: ai bordi si ferma", () => {
    list();
    expect(press(container, "ArrowUp").defaultPrevented).toBe(true);
    expect(activeRow()).toBe(rows()[0]);
    press(container, "End");
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[4]);
    expect(highlighted).toEqual(["e"]);
  });

  it("gira se glielo si chiede", () => {
    list({ wrap: true });
    press(container, "ArrowUp");
    expect(activeRow()).toBe(rows()[4]);
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[0]);
  });

  it("salta le voci che non si possono scegliere", () => {
    list({
      items: [
        { id: "a", name: "Albicocca", off: true },
        { id: "b", name: "Banana" },
        { id: "c", name: "Ciliegia", off: true },
        { id: "d", name: "Cocomero" },
      ],
    });
    expect(activeRow()).toBe(rows()[1]);
    expect(rows()[0].getAttribute("aria-disabled")).toBe("true");
    expect(rows()[1].hasAttribute("aria-disabled")).toBe(false);
    press(container, "ArrowDown");
    expect(activeRow()).toBe(rows()[3]);
    press(container, "Home");
    expect(activeRow()).toBe(rows()[1]);
    rows()[2].click();
    rows()[2].dispatchEvent(pointer("pointermove"));
    expect(activated).toEqual([]);
    expect(activeRow()).toBe(rows()[1]);
  });

  it("PagGiù e PagSu saltano di una pagina di righe", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, name: `Riga ${index}` }));
    list({ items: many });
    // Senza misure il salto è quello di ripiego, dieci righe.
    press(container, "PageDown");
    expect(activeRow()).toBe(rows()[10]);
    // Con le misure: 140 px di lista, righe da 28, una resta in vista.
    rows().forEach((row) => measure(row, { height: 28 }));
    Object.defineProperty(container, "clientHeight", { value: 140, configurable: true });
    press(container, "PageDown");
    expect(activeRow()).toBe(rows()[14]);
    press(container, "PageUp");
    press(container, "PageUp");
    press(container, "PageUp");
    press(container, "PageUp");
    expect(activeRow()).toBe(rows()[0]);
    press(container, "End");
    press(container, "PageDown");
    expect(activeRow()).toBe(rows()[39]);
  });

  it("Invio e Spazio attivano; con Ctrl le frecce non sono sue", () => {
    list();
    press(container, "ArrowDown");
    expect(press(container, "Enter").defaultPrevented).toBe(true);
    expect(press(container, " ").defaultPrevented).toBe(true);
    expect(activated).toEqual(["b", "b"]);
    expect(press(container, "ArrowDown", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(container, "ArrowDown", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(activeRow()).toBe(rows()[1]);
  });

  it("senza una riga attiva Invio passa oltre", () => {
    list({ role: "menu" });
    expect(press(container, "Enter").defaultPrevented).toBe(false);
    expect(activated).toEqual([]);
  });

  it("porta in vista la riga raggiunta con i tasti, non quella sfiorata", () => {
    list();
    const seen: unknown[] = [];
    for (const row of rows()) {
      row.scrollIntoView = (options?: boolean | ScrollIntoViewOptions) => void seen.push(options);
    }
    rows()[3].dispatchEvent(pointer("pointermove"));
    expect(seen).toEqual([]);
    press(container, "ArrowDown");
    expect(seen).toEqual([{ block: "nearest" }]);
  });
});

describe("la ricerca a battuta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("va alla voce che comincia con ciò che si batte", () => {
    list({ typeahead: (item) => item.name });
    expect(press(container, "c").defaultPrevented).toBe(true);
    expect(activeRow()).toBe(rows()[2]);
    press(container, "o");
    expect(activeRow()).toBe(rows()[3]);
    expect(activated).toEqual([]);
  });

  it("una lettera ripetuta scorre fra le voci che cominciano con lei", () => {
    list({ typeahead: (item) => item.name });
    press(container, "c");
    expect(activeRow()).toBe(rows()[2]);
    press(container, "c");
    expect(activeRow()).toBe(rows()[3]);
    press(container, "C");
    expect(activeRow()).toBe(rows()[2]);
  });

  it("dimentica la parola dopo mezzo secondo senza tasti", () => {
    list({ typeahead: (item) => item.name });
    press(container, "c");
    vi.advanceTimersByTime(TYPEAHEAD_MS - 1);
    press(container, "o");
    expect(activeRow()).toBe(rows()[3]);
    vi.advanceTimersByTime(TYPEAHEAD_MS);
    press(container, "d");
    expect(activeRow()).toBe(rows()[4]);
  });

  it("a parola in corso lo spazio è una lettera, non un'attivazione", () => {
    list({ typeahead: (item) => item.name });
    press(container, "b");
    press(container, " ");
    expect(activated).toEqual([]);
    vi.advanceTimersByTime(TYPEAHEAD_MS);
    press(container, " ");
    expect(activated).toEqual(["b"]);
  });

  it("senza testo da cercare i caratteri passano oltre", () => {
    list();
    expect(press(container, "c").defaultPrevented).toBe(false);
    expect(activeRow()).toBe(rows()[0]);
  });

  it("smontata, non lascia un timer in sospeso", () => {
    list({ typeahead: (item) => item.name });
    press(container, "c");
    expect(vi.getTimerCount()).toBe(1);
    life.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("il puntatore", () => {
  it("muoversi su una riga la attiva, premerla la sceglie", () => {
    list();
    rows()[3].dispatchEvent(pointer("pointermove"));
    expect(activeRow()).toBe(rows()[3]);
    expect(highlighted).toEqual(["d"]);
    rows()[3].dispatchEvent(pointer("pointermove"));
    expect(highlighted).toEqual(["d"]);
    rows()[1].click();
    expect(activated).toEqual(["b"]);
    expect(activeRow()).toBe(rows()[1]);
  });

  it("riconosce la riga anche da un elemento al suo interno", () => {
    list({
      render: (item, row) => {
        const inner = document.createElement("span");
        inner.textContent = item.name;
        row.append(inner);
      },
    });
    rows()[2].querySelector("span")!.click();
    expect(activated).toEqual(["c"]);
  });
});

describe("le voci che cambiano", () => {
  it("la riga attiva resta la stessa voce, e le righe che restano non si ricreano", () => {
    const handle = list();
    press(container, "ArrowDown");
    press(container, "ArrowDown");
    highlighted = [];
    const [, , kept] = rows();
    handle.setItems([FRUITS[4], FRUITS[2], FRUITS[0]]);
    expect(rows().map((row) => row.textContent)).toEqual(["Dattero", "Ciliegia", "Albicocca"]);
    expect(rows()[1]).toBe(kept);
    expect(activeRow()).toBe(kept);
    expect(container.getAttribute("aria-activedescendant")).toBe(kept.id);
    expect(handle.active()?.id).toBe("c");
    // È la stessa voce: nessuno va avvisato.
    expect(highlighted).toEqual([]);
  });

  it("se la voce attiva sparisce si torna alla prima, e si avvisa", () => {
    const handle = list();
    press(container, "End");
    highlighted = [];
    handle.setItems(FRUITS.slice(1, 3));
    expect(activeRow()).toBe(rows()[0]);
    expect(handle.active()?.id).toBe("b");
    expect(highlighted).toEqual(["b"]);
    handle.setItems([]);
    expect(activeRow()).toBeNull();
    expect(container.hasAttribute("aria-activedescendant")).toBe(false);
    expect(highlighted).toEqual(["b", null]);
    expect(highlight().hidden).toBe(true);
  });

  it("una voce cambiata si ridisegna, una uguale no", () => {
    const render = vi.fn((item: Fruit, row: HTMLElement) => {
      row.textContent = item.name;
    });
    const handle = list({ render });
    expect(render).toHaveBeenCalledTimes(5);
    handle.setItems([FRUITS[0], { id: "b", name: "Bergamotto" }]);
    expect(render).toHaveBeenCalledTimes(6);
    expect(rows().map((row) => row.textContent)).toEqual(["Albicocca", "Bergamotto"]);
  });

  it("di due voci con la stessa chiave resta la prima", () => {
    list({ items: [FRUITS[0], { id: "a", name: "Doppione" }, FRUITS[1]] });
    expect(rows().map((row) => row.textContent)).toEqual(["Albicocca", "Banana"]);
  });

  it("setActive sceglie per chiave, e ignora ciò che non c'è o non si può", () => {
    const handle = list({ items: [...FRUITS, { id: "z", name: "Zucca", off: true }] });
    handle.setActive("d");
    expect(activeRow()).toBe(handle.element("d"));
    handle.setActive("z");
    handle.setActive("non-c'è");
    expect(handle.active()?.id).toBe("d");
    handle.setActive(null);
    expect(handle.active()).toBeNull();
    expect(handle.element("non-c'è")).toBeNull();
    expect(highlighted).toEqual(["d", null]);
  });
});

describe("il fuoco che viaggia", () => {
  it("una riga sola è nel giro di Tab, e il fuoco la segue", () => {
    list({ focus: "roving" });
    expect(container.hasAttribute("tabindex")).toBe(false);
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    rows()[0].focus();
    press(rows()[0], "ArrowDown");
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    expect(container.hasAttribute("aria-activedescendant")).toBe(false);
    press(rows()[1], "Enter");
    expect(activated).toEqual(["b"]);
  });

  it("non ruba il fuoco a chi sta altrove", () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    const handle = list({ focus: "roving" });
    handle.setActive("c");
    expect(document.activeElement).toBe(elsewhere);
    expect(rows()[2].tabIndex).toBe(0);
  });

  it("senza riga attiva la fermata di Tab è la prima che si può scegliere", () => {
    list({ focus: "roving", role: "menu", items: [{ id: "a", name: "Albicocca", off: true }, FRUITS[1]] });
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0]);
    rows()[1].focus();
    expect(activeRow()).toBe(rows()[1]);
  });
});

describe("il rettangolo", () => {
  it("è uno solo, sta sotto le righe e prende misura e posto della riga attiva", () => {
    const handle = list({ role: "menu" });
    expect(container.querySelectorAll(".kit-list-highlight").length).toBe(1);
    expect(container.firstElementChild).toBe(highlight());
    expect(highlight().getAttribute("aria-hidden")).toBe("true");
    expect(highlight().hidden).toBe(true);
    layOut();
    handle.setActive("c");
    expect(highlight().hidden).toBe(false);
    expect(highlight().style.width).toBe("200px");
    expect(highlight().style.height).toBe("28px");
    expect(highlight().style.getPropertyValue("translate")).toBe("4px 60px");
  });

  it("scivola da una riga all'altra con la molla, e arriva esatto", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const handle = list({ role: "menu" });
    layOut();
    // La prima volta compare al suo posto: non ha da dove venire.
    handle.setActive("a");
    expect(highlight().style.getPropertyValue("translate")).toBe("4px 4px");
    expect(activeMotions()).toBe(0);

    press(container, "End");
    // Lo stato è già quello finale; il rettangolo è ancora in viaggio.
    expect(activeRow()).toBe(rows()[4]);
    driver.advance(32);
    const [, y] = highlight().style.getPropertyValue("translate").split(" ").map(parseFloat);
    expect(y).toBeGreaterThan(4);
    expect(y).toBeLessThan(116);
    expect(activeMotions()).toBeGreaterThan(0);
    driver.advance(2000);
    expect(highlight().style.getPropertyValue("translate")).toBe("4px 116px");
    expect(activeMotions()).toBe(0);
  });

  it("nel livello ridotto salta", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    const handle = list({ role: "menu" });
    layOut();
    handle.setActive("a");
    press(container, "End");
    expect(highlight().style.getPropertyValue("translate")).toBe("4px 116px");
    expect(activeMotions()).toBe(0);
  });

  it("quando le voci cambiano si riposa senza scivolare", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    const handle = list();
    layOut();
    handle.setActive("e");
    driver.advance(2000);
    handle.setItems([FRUITS[4], FRUITS[0]]);
    layOut();
    handle.setItems([FRUITS[4], FRUITS[0]]);
    expect(highlight().style.getPropertyValue("translate")).toBe("4px 4px");
    expect(activeMotions()).toBe(0);
  });
});

describe("lo smontaggio", () => {
  it("toglie righe, rettangolo e ciò che aveva scritto sul contenitore", () => {
    list();
    life.close();
    expect(container.children.length).toBe(0);
    expect(container.hasAttribute("role")).toBe(false);
    expect(container.hasAttribute("tabindex")).toBe(false);
    expect(container.hasAttribute("aria-activedescendant")).toBe(false);
    expect(container.hasAttribute("id")).toBe(false);
    expect(container.classList.contains("kit-list")).toBe(false);
  });

  it("smontata, non risponde più a tasti e puntatore", () => {
    const handle = list();
    const [first] = rows();
    life.close();
    press(container, "ArrowDown");
    press(container, "Enter");
    first.click();
    handle.setItems(FRUITS);
    handle.setActive("b");
    expect(activated).toEqual([]);
    expect(highlighted).toEqual([]);
    expect(container.children.length).toBe(0);
  });

  it("montata e smontata molte volte non lascia corse né righe", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    for (let round = 0; round < 5; round++) {
      const each = openLifetime();
      const handle = list({ lifetime: each });
      layOut();
      handle.setActive("a");
      press(container, "End");
      expect(activeMotions()).toBeGreaterThan(0);
      each.close();
      expect(activeMotions()).toBe(0);
      expect(container.children.length).toBe(0);
    }
  });
});
