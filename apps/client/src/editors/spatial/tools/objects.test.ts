// @vitest-environment happy-dom
// L'albero degli oggetti da solo: le righe dal davanti, la tastiera del
// pattern ARIA, la selezione che segue il fuoco, il nome che si cambia, il
// filtro, le righe disegnate oltre le 500, lo spostamento col puntatore, col
// dito e con Alt e le frecce, e le miniature.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { createObjectTree, ROW_PX, VIRTUAL_AFTER, type ObjectTree, type ObjectTreeOptions, type TreeDrop, type TreeEntry, type TreeToggle } from "./objects";

function object(key: string, selectable = true, more: Partial<TreeEntry> = {}): TreeEntry {
  return {
    key,
    layer: false,
    selectable,
    locked: false,
    hidden: false,
    toggles: selectable,
    name: null,
    renames: true,
    moves: true,
    kind: "shape",
    children: [],
    label: () => `Oggetto ${key}`,
    ...more,
  };
}

function layer(key: string, children: readonly TreeEntry[], state = ""): TreeEntry {
  return {
    key,
    layer: true,
    selectable: false,
    locked: state !== "",
    hidden: false,
    toggles: true,
    name: key,
    renames: true,
    moves: true,
    kind: "layer",
    children,
    label: () => `Livello ${key}${state}`,
  };
}

const ENTRIES: readonly TreeEntry[] = [
  layer("l1", [object("a", false)], ", bloccato"),
  layer("l2", [object("b"), object("c"), object("d")]),
  object("e"),
];

let host: HTMLElement;
let life: Lifetime;
let tree: ObjectTree;
let chosen: string[][];
let calls: string[];

function mount(entries: readonly TreeEntry[] = ENTRIES, selection: readonly string[] = [], more: Partial<ObjectTreeOptions> = {}): ObjectTree {
  tree = createObjectTree(life, {
    onSelect: (keys) => {
      chosen.push([...keys]);
      tree.update(entries, keys, 5);
    },
    onActivate: () => calls.push("activate"),
    onDelete: () => calls.push("delete"),
    onLeave: () => calls.push("leave"),
    onToggle: (key: string, what: TreeToggle) => calls.push(`${what} ${key}`),
    onRename: (key: string, name: string) => {
      calls.push(`rename ${key} ${name}`);
      return key;
    },
    ...more,
  });
  host.append(tree.element);
  tree.relabel();
  tree.update(entries, selection, 5);
  return tree;
}

const treeEl = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
const active = (): HTMLElement | null => document.getElementById(treeEl().getAttribute("aria-activedescendant") ?? "");

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  treeEl().dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  chosen = [];
  calls = [];
});

afterEach(() => {
  life.close();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("le righe", () => {
  it("dicono livello, posizione, scelta e stato, e non solo col colore", () => {
    mount(ENTRIES, ["c"]);
    expect(treeEl().getAttribute("aria-multiselectable")).toBe("true");
    expect(treeEl().getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    expect(host.querySelector("h2")!.textContent).toBe("Oggetti");
    expect(host.querySelector(".draw-objects-count")!.textContent).toBe("5 oggetti");
    // Dal davanti: in cima ciò che il documento ha per ultimo.
    expect(rows().map((row) => [row.textContent, row.getAttribute("aria-level"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")])).toEqual([
      ["✓Oggetto e", "1", "1", "3"],
      ["▾Livello l2", "1", "2", "3"],
      ["✓Oggetto d", "2", "1", "3"],
      ["✓Oggetto c", "2", "2", "3"],
      ["✓Oggetto b", "2", "3", "3"],
      ["▾Livello l1, bloccato", "1", "3", "3"],
      ["✓Oggetto a", "2", "1", "1"],
    ]);
    // I segni sono nascosti agli screen reader: per loro c'è `aria-selected`,
    // e il nome dice che il livello è bloccato.
    const locked = rows()[5]!;
    for (const part of [".draw-object-twisty", ".draw-object-mark", ".draw-object-signs"]) expect(locked.querySelector(part)!.getAttribute("aria-hidden")).toBe("true");
    expect(locked.querySelector('[data-sign="lock"]')!.hasAttribute("data-on")).toBe(true);
    expect(locked.querySelector('[data-sign="hide"]')!.hasAttribute("data-on")).toBe(false);
    expect(locked.getAttribute("aria-expanded")).toBe("true");
    expect(locked.hasAttribute("aria-selected")).toBe(false);
    expect(rows()[6]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false", null, "false", "true", "false", null, "false"]);
    // Il fuoco non è nell'albero: la riga attiva va al primo oggetto scelto.
    expect(active()?.dataset.key).toBe("c");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("dicono quando il disegno è vuoto", () => {
    mount([]);
    expect(host.querySelector<HTMLElement>(".draw-objects-empty")!.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>(".draw-objects-empty")!.textContent).toBe("Il disegno è vuoto.");
    expect(host.querySelector<HTMLElement>(".draw-objects-scroll")!.hidden).toBe(true);
    expect(treeEl().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("restano gli stessi nodi quando cambia soltanto la scelta", () => {
    mount();
    const before = rows();
    tree.update(ENTRIES, ["b", "d"], 5);
    expect(rows()).toEqual(before);
    expect(rows()[2]!.getAttribute("aria-selected")).toBe("true");
  });

  it("dicono la selezione in ordine di documento, anche con oggetti che una riga chiusa non mostra", () => {
    mount(ENTRIES, ["b"]);
    host.querySelector('[data-key="l2"] .draw-object-label')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(rows().map((row) => row.dataset.key)).toEqual(["e", "l2", "l1", "a"]);
    host.querySelector('[data-key="e"] .draw-object-label')!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(chosen.pop()).toEqual(["b", "e"]);
  });
});

describe("la tastiera", () => {
  it("le frecce scelgono la riga a cui arrivano; un livello non sceglie niente", () => {
    mount();
    tree.focus();
    expect(active()?.dataset.key).toBe("e");
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("l2");
    expect(chosen.pop()).toEqual([]);
    key("ArrowDown");
    expect(chosen.pop()).toEqual(["d"]);
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    key("End");
    // Un oggetto di un livello bloccato non si sceglie.
    expect(active()?.dataset.key).toBe("a");
    expect(chosen.pop()).toEqual([]);
    key("Home");
    expect(chosen.pop()).toEqual(["e"]);
  });

  it("Ctrl sposta soltanto, Spazio aggiunge e toglie, Maiusc estende", () => {
    mount();
    tree.focus();
    key("ArrowDown");
    key("ArrowDown");
    expect(chosen.pop()).toEqual(["d"]);
    key("ArrowDown", { ctrlKey: true });
    key("ArrowDown", { ctrlKey: true });
    expect(chosen).toHaveLength(1);
    expect(active()?.dataset.key).toBe("b");
    key(" ");
    expect(chosen.pop()).toEqual(["b", "d"]);
    key(" ");
    expect(chosen.pop()).toEqual(["d"]);
    key("ArrowUp", { shiftKey: true });
    expect(chosen.pop()).toEqual(["b", "c"]);
    key("a", { ctrlKey: true });
    expect(chosen.pop()).toEqual(["b", "c", "d", "e"]);
  });

  it("le frecce laterali aprono, chiudono e salgono al livello", () => {
    mount();
    tree.focus();
    key("ArrowDown");
    key("ArrowLeft");
    expect(rows().map((row) => row.dataset.key)).toEqual(["e", "l2", "l1", "a"]);
    expect(rows()[1]!.getAttribute("aria-expanded")).toBe("false");
    expect(rows()[1]!.querySelector(".draw-object-twisty")!.textContent).toBe("▸");
    key("ArrowRight");
    expect(rows()).toHaveLength(7);
    key("ArrowRight");
    expect(active()?.dataset.key).toBe("d");
    key("ArrowLeft");
    expect(active()?.dataset.key).toBe("l2");
    // Spazio su un livello sceglie i suoi oggetti.
    key(" ");
    expect(chosen.pop()).toEqual(["b", "c", "d"]);
  });

  it("Invio apre le proprietà, Canc elimina, Esc torna al foglio, e il foglio non sente i tasti", () => {
    mount();
    let outside = 0;
    host.addEventListener("keydown", () => outside++);
    tree.focus();
    key("Home");
    key("Enter");
    key("Delete");
    key("Escape");
    expect(calls).toEqual(["activate", "delete", "leave"]);
    expect(outside).toBe(0);
    // Un tasto che l'albero non usa passa.
    expect(key("x").defaultPrevented).toBe(false);
    expect(outside).toBe(1);
  });
});

describe("il puntatore", () => {
  it("un clic sceglie, con Ctrl aggiunge, con Maiusc estende; sul livello lo chiude", () => {
    mount();
    const click = (keyName: string, init: MouseEventInit = {}): void => {
      host.querySelector(`[data-key="${keyName}"] .draw-object-label`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
    };
    click("b");
    expect(chosen.pop()).toEqual(["b"]);
    expect(document.activeElement).toBe(treeEl());
    click("d", { ctrlKey: true });
    expect(chosen.pop()).toEqual(["b", "d"]);
    click("e", { shiftKey: true });
    expect(chosen.pop()).toEqual(["d", "e"]);
    click("l2");
    expect(rows().map((row) => row.dataset.key)).toEqual(["e", "l2", "l1", "a"]);
    host.querySelector('[data-key="e"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(calls).toEqual(["activate"]);
  });
});

describe("dentro i gruppi", () => {
  const NESTED: readonly TreeEntry[] = [
    layer("l1", [
      object("g", true, { children: [object("a"), object("i", true, { children: [object("b")] }), object("c", false, { locked: true, toggles: true })] }),
      object("h", false, { hidden: true }),
    ]),
  ];

  it("un gruppo nasce chiuso e si apre con le frecce, come un livello, e resta scelto da solo", () => {
    mount(NESTED);
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g"]);
    expect(rows()[2]!.getAttribute("aria-expanded")).toBe("false");
    expect(rows()[2]!.textContent).toBe("▸✓Oggetto g");
    // Un oggetto senza figli non si apre.
    expect(rows()[1]!.hasAttribute("aria-expanded")).toBe(false);
    tree.focus();
    key("ArrowDown");
    key("ArrowDown");
    expect(chosen.pop()).toEqual(["g"]);
    key("ArrowRight");
    expect(rows().map((row) => [row.dataset.key, row.getAttribute("aria-level")])).toEqual([["l1", "1"], ["h", "2"], ["g", "2"], ["c", "3"], ["i", "3"], ["a", "3"]]);
    expect(rows()[3]!.style.getPropertyValue("--draw-depth")).toBe("2");
    key("ArrowRight");
    expect(active()?.dataset.key).toBe("c");
    key("End");
    expect(chosen.pop()).toEqual(["a"]);
    key("ArrowLeft");
    expect(active()?.dataset.key).toBe("g");
    key("ArrowLeft");
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g"]);
  });

  it("apre ciò che contiene la prima riga scelta quando la selezione arriva da fuori, una volta", () => {
    mount(NESTED);
    tree.update(NESTED, ["b"], 2);
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g", "c", "i", "b", "a"]);
    expect(active()?.dataset.key).toBe("b");
    // Chiuso a mano, resta chiuso finché la selezione è quella.
    host.querySelector('[data-key="g"] .draw-object-twisty')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g"]);
    expect(chosen).toEqual([]);
    (document.activeElement as HTMLElement).blur();
    tree.update(NESTED, ["b"], 2);
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g"]);
  });

  it("blocca e nasconde la riga attiva coi tasti e coi segni, dove si può", () => {
    mount(NESTED, ["c"]);
    tree.focus();
    expect(active()?.dataset.key).toBe("c");
    expect(active()!.querySelector('[data-sign="lock"]')!.hasAttribute("data-on")).toBe(true);
    expect(active()!.querySelector<HTMLElement>('[data-sign="lock"]')!.title).toBe("Sblocca");
    expect(active()!.querySelector<HTMLElement>('[data-sign="hide"]')!.title).toBe("Nascondi");
    expect(key("L", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    key("h", { metaKey: true, shiftKey: true });
    expect(calls).toEqual(["lock c", "hide c"]);
    // Senza Maiusc, o su una riga che non si cambia, il tasto passa.
    expect(key("l", { ctrlKey: true }).defaultPrevented).toBe(false);
    key("Home");
    key("ArrowDown", { ctrlKey: true });
    expect(active()?.dataset.key).toBe("h");
    expect(active()!.hasAttribute("data-toggles")).toBe(false);
    expect(active()!.querySelector<HTMLElement>('[data-sign="hide"]')!.title).toBe("");
    expect(key("h", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    host.querySelector('[data-key="h"] [data-sign="hide"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    host.querySelector('[data-key="l1"] [data-sign="hide"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Il segno cambia, e non sceglie né chiude il livello.
    expect(calls).toEqual(["lock c", "hide c", "hide l1"]);
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "h", "g", "c", "i", "a"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});

describe("tante righe", () => {
  it(`oltre ${VIRTUAL_AFTER} ne disegna una finestra, con posizioni e totale veri`, () => {
    const many = Array.from({ length: 2000 }, (_, index) => object(`o${index}`));
    mount([layer("l1", many)]);
    const scroller = host.querySelector<HTMLElement>(".draw-objects-scroll")!;
    expect(treeEl().hasAttribute("data-virtual")).toBe(true);
    expect(treeEl().style.height).toBe(`${2001 * ROW_PX}px`);
    expect(rows().length).toBeLessThan(100);
    expect(rows()[1]!.getAttribute("aria-setsize")).toBe("2000");
    tree.focus();
    key("End");
    expect(chosen.pop()).toEqual(["o0"]);
    expect(active()?.dataset.key).toBe("o0");
    expect(active()?.getAttribute("aria-posinset")).toBe("2000");
    expect(active()?.style.top).toBe(`${2000 * ROW_PX}px`);
    expect(rows().length).toBeLessThan(100);
    // Lo scorrimento disegna le righe che arrivano in vista.
    scroller.scrollTop = 1000 * ROW_PX;
    scroller.dispatchEvent(new Event("scroll"));
    expect(rows().some((row) => row.dataset.key === "o1000")).toBe(true);
  });

  it(`fino a ${VIRTUAL_AFTER} le disegna tutte`, () => {
    mount([layer("l1", Array.from({ length: VIRTUAL_AFTER - 1 }, (_, index) => object(`o${index}`)))]);
    expect(rows()).toHaveLength(VIRTUAL_AFTER);
    expect(treeEl().hasAttribute("data-virtual")).toBe(false);
  });
});

describe("il nome", () => {
  const field = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".draw-object-rename");

  function type(text: string, finish: "Enter" | "Escape" | "blur"): void {
    const input = field()!;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (finish === "blur") input.blur();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: finish, bubbles: true, cancelable: true }));
  }

  it("F2 apre sulla riga il campo col nome di adesso; Invio scrive quello nuovo, ripulito, e il fuoco torna all'albero", () => {
    mount([layer("l1", [object("a", true, { name: "Tetto" }), object("b")])]);
    tree.focus();
    key("ArrowDown");
    expect(key("F2").defaultPrevented).toBe(true);
    const input = field()!;
    expect(input.closest('[data-key="b"]')).not.toBeNull();
    expect(input.closest('[data-key="b"]')!.hasAttribute("data-renaming")).toBe(true);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-label")).toBe("Nome di Oggetto b");
    expect(document.activeElement).toBe(input);
    // I tasti del campo sono suoi: non muovono la riga attiva.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(active()?.dataset.key).toBe("b");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    type("  Porta \n d’ingresso ", "Enter");
    expect(calls).toEqual(["rename b Porta d’ingresso"]);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(treeEl());
    expect(rows()[1]!.hasAttribute("data-renaming")).toBe(false);
    // Il nome di adesso è il punto di partenza; lo stesso nome non scrive niente.
    key("ArrowDown");
    key("F2");
    expect(field()!.value).toBe("Tetto");
    type("Tetto ", "Enter");
    expect(calls).toHaveLength(1);
  });

  it("Esc lascia il nome com'era; uscire dal campo lo scrive; un nome vuoto lo toglie", () => {
    mount([layer("l1", [object("a", true, { name: "Tetto" })])]);
    tree.focus();
    key("End");
    key("F2");
    type("Casa", "Escape");
    expect(calls).toEqual([]);
    expect(document.activeElement).toBe(treeEl());
    key("F2");
    type("", "blur");
    expect(calls).toEqual(["rename a "]);
  });

  it("il doppio clic sul nome lo cambia, altrove apre le proprietà; anche un livello si rinomina", () => {
    mount();
    const dblclick = (target: Element): void => {
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    };
    dblclick(host.querySelector('[data-key="c"] .draw-object-mark')!);
    expect(calls).toEqual(["activate"]);
    expect(field()).toBeNull();
    dblclick(host.querySelector('[data-key="c"] .draw-object-label')!);
    expect(field()?.closest('[data-key="c"]')).not.toBeNull();
    // Un clic nel campo muove il cursore, non la selezione.
    field()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen).toEqual([]);
    type("Camino", "Enter");
    dblclick(host.querySelector('[data-key="l2"] .draw-object-label')!);
    expect(field()!.value).toBe("l2");
    type("Sfondo", "Enter");
    expect(calls).toEqual(["activate", "rename c Camino", "rename l2 Sfondo"]);
  });

  it("non si apre dove non si rinomina, o dove l'editor dice di no", () => {
    const refused: string[] = [];
    mount([layer("l1", [object("a", true, { renames: false }), object("b")])], [], {
      canRename: (keyName) => {
        refused.push(keyName);
        return false;
      },
    });
    tree.focus();
    key("End");
    expect(key("F2").defaultPrevented).toBe(false);
    key("ArrowUp");
    key("F2");
    expect(refused).toEqual(["b"]);
    expect(field()).toBeNull();
  });

  it("rename() apre ciò che contiene la voce e il campo; se la voce se ne va, il campo con lei", () => {
    const NESTED = [layer("l1", [object("g", true, { children: [object("a"), object("b")] })])];
    mount(NESTED);
    expect(tree.rename("b")).toBe(true);
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "g", "b", "a"]);
    expect(field()?.closest('[data-key="b"]')).not.toBeNull();
    expect(active()?.dataset.key).toBe("b");
    tree.update([layer("l1", [object("g", true, { children: [object("a")] })])], [], 1);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(treeEl());
    expect(calls).toEqual([]);
    expect(tree.rename("nessuno")).toBe(false);
  });
});

describe("il filtro", () => {
  const FILTERED: readonly TreeEntry[] = [
    layer("l1", [
      object("r", true, { label: () => "Rettangolo «Tetto»" }),
      object("t", true, { kind: "text", label: () => "Testo «Città»" }),
    ]),
    layer("l2", [
      object("g", true, {
        kind: "group",
        label: () => "Gruppo «Casa»",
        children: [object("p", true, { label: () => "Cerchio «Porta»" }), object("s", true, { kind: "stroke", label: () => "Tratto a penna" })],
      }),
    ]),
  ];
  const search = (): HTMLInputElement => host.querySelector<HTMLInputElement>(".draw-objects-search")!;
  const kind = (): HTMLSelectElement => host.querySelector<HTMLSelectElement>(".draw-objects-kind")!;
  const status = (): string => host.querySelector(".draw-objects-status")!.textContent ?? "";
  const keys = (): (string | undefined)[] => rows().map((row) => `${row.dataset.key}${row.hasAttribute("data-context") ? "°" : ""}`);

  function find(text: string, type = "all"): void {
    search().value = text;
    search().dispatchEvent(new Event("input", { bubbles: true }));
    if (kind().value !== type) {
      kind().value = type;
      kind().dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function press(target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("c'è solo quando l'editor lo offre, con un nome per la ricerca e per il tipo", () => {
    mount(FILTERED);
    expect(host.querySelector<HTMLElement>(".draw-objects-filter")!.hidden).toBe(true);
    tree.setFiltering(true);
    expect(host.querySelector<HTMLElement>(".draw-objects-filter")!.hidden).toBe(false);
    expect(search().getAttribute("aria-label")).toBe("Cerca fra gli oggetti");
    expect(search().placeholder).toBe("Cerca");
    expect(search().getAttribute("aria-controls")).toBe(treeEl().id);
    expect(kind().getAttribute("aria-label")).toBe("Tipo di oggetto");
    expect([...kind().options].map((option) => option.textContent)).toEqual(["Tutti i tipi", "Tratti", "Forme", "Testi", "Immagini", "Gruppi", "Collegamenti"]);
    expect(host.querySelector(".draw-objects-status")!.getAttribute("role")).toBe("status");
    expect(status()).toBe("");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("lascia le righe con tutte le parole, maiuscole e accenti a parte, e ciò che le contiene", () => {
    mount(FILTERED);
    tree.setFiltering(true);
    find("CITTA");
    expect(keys()).toEqual(["l1°", "t"]);
    expect(status()).toBe("1 oggetto trovato.");
    find("rettangolo tetto");
    expect(keys()).toEqual(["l1°", "r"]);
    // Un gruppo trovato porta con sé ciò che contiene, e si apre.
    find("casa");
    expect(keys()).toEqual(["l2°", "g", "s", "p"]);
    expect(rows()[1]!.getAttribute("aria-expanded")).toBe("true");
    expect(status()).toBe("3 oggetti trovati.");
    // Anche un livello porta con sé i suoi oggetti, e non conta.
    find("livello l1");
    expect(keys()).toEqual(["l1°", "t", "r"]);
    expect(rows()[1]!.getAttribute("aria-posinset")).toBe("1");
    expect(rows()[1]!.getAttribute("aria-setsize")).toBe("2");
    find("nulla");
    expect(keys()).toEqual([]);
    expect(status()).toBe("Nessun oggetto trovato.");
    expect(host.querySelector<HTMLElement>(".draw-objects-empty")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".draw-objects-scroll")!.hidden).toBe(true);
  });

  it("il tipo vale riga per riga, e con le parole di chi contiene", () => {
    mount(FILTERED);
    tree.setFiltering(true);
    find("", "shape");
    expect(keys()).toEqual(["l2°", "g°", "p", "l1°", "r"]);
    expect(status()).toBe("2 oggetti trovati.");
    find("casa", "shape");
    expect(keys()).toEqual(["l2°", "g°", "p"]);
    find("casa", "stroke");
    expect(keys()).toEqual(["l2°", "g°", "s"]);
    find("", "group");
    expect(keys()).toEqual(["l2°", "g"]);
    expect(rows()[1]!.hasAttribute("aria-expanded")).toBe(false);
  });

  it("Ctrl+A sceglie le righe trovate; la selezione tiene anche gli oggetti che il filtro non mostra", () => {
    mount(FILTERED, ["r"]);
    tree.setFiltering(true);
    find("casa", "shape");
    tree.focus();
    key("a", { ctrlKey: true });
    expect(chosen.pop()).toEqual(["p"]);
    tree.update(FILTERED, ["r"], 5);
    host.querySelector('[data-key="p"] .draw-object-label')!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    expect(chosen.pop()).toEqual(["r", "p"]);
    // Spazio su un livello sceglie i suoi oggetti trovati.
    find("tetto");
    key("Home");
    key(" ");
    expect(chosen.pop()).toEqual(["r"]);
  });

  it("chiuso a mano resta chiuso finché il filtro è quello", () => {
    mount(FILTERED);
    tree.setFiltering(true);
    find("casa");
    host.querySelector('[data-key="g"] .draw-object-twisty')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(keys()).toEqual(["l2°", "g"]);
    expect(rows()[1]!.getAttribute("aria-expanded")).toBe("false");
    find("cas");
    expect(keys()).toEqual(["l2°", "g", "s", "p"]);
  });

  it("dalla ricerca la freccia giù porta all'albero, Esc la svuota e poi porta all'albero; Ctrl+F ci torna", () => {
    mount(FILTERED);
    tree.setFiltering(true);
    search().focus();
    find("casa");
    expect(press(search(), "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(treeEl());
    expect(active()?.dataset.key).toBe("l2");
    expect(press(treeEl(), "f", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search());
    press(search(), "Escape");
    expect(search().value).toBe("");
    expect(keys()).toEqual(["l2", "g", "l1", "t", "r"]);
    expect(document.activeElement).toBe(search());
    press(search(), "Escape");
    expect(document.activeElement).toBe(treeEl());
    expect(calls).toEqual([]);
  });

  it("nascosto si svuota, e il disegno torna tutto", () => {
    mount(FILTERED);
    tree.setFiltering(true);
    find("casa", "shape");
    tree.setFiltering(false);
    expect(search().value).toBe("");
    expect(kind().value).toBe("all");
    expect(keys()).toEqual(["l2", "g", "l1", "t", "r"]);
    expect(status()).toBe("");
    // Senza filtro Ctrl+F è del browser.
    tree.focus();
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it(`oltre ${VIRTUAL_AFTER} voci aspetta che si smetta di scrivere`, () => {
    vi.useFakeTimers();
    try {
      const many = Array.from({ length: VIRTUAL_AFTER + 10 }, (_, index) => object(`o${index}`));
      mount([layer("l1", many)]);
      tree.setFiltering(true);
      find("oggetto o7");
      expect(treeEl().hasAttribute("data-virtual")).toBe(true);
      vi.advanceTimersByTime(200);
      expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "o79", "o78", "o77", "o76", "o75", "o74", "o73", "o72", "o71", "o70", "o7"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("spostare", () => {
  const group = (key: string, children: readonly TreeEntry[]): TreeEntry => object(key, true, { kind: "group", children });
  // Dal davanti: l2, d, g (chiuso), b, l1, a.
  const MOVABLE: readonly TreeEntry[] = [layer("l1", [object("a")]), layer("l2", [object("b"), group("g", [object("g1"), object("g2")]), object("d")])];

  let moves: (readonly [readonly string[], TreeDrop])[];
  let edges: string[];

  function mountMoving(selection: readonly string[], more: Partial<ObjectTreeOptions> = {}): ObjectTree {
    moves = [];
    edges = [];
    return mount(MOVABLE, selection, {
      onMove: (keys, drop) => {
        moves.push([[...keys], drop]);
        return keys;
      },
      onEdge: (key, front) => edges.push(`${key} ${front ? "front" : "back"}`),
      ...more,
    });
  }

  const rowEl = (key: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-object[data-key="${key}"]`)!;
  const labelOf = (key: string): HTMLElement => rowEl(key).querySelector<HTMLElement>(".draw-object-label")!;
  const depthOf = (key: string): string => rowEl(key).style.getPropertyValue("--draw-drop-depth");

  /// Le righe una sotto l'altra, alte `ROW_PX`, con la freccia larga 20 px
  /// che rientra di 20 px per livello; l'elenco lontano dai bordi, perché non
  /// scorra. happy-dom non impagina.
  function layout(): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      let top = 0;
      let height = 0;
      let left = 0;
      let width = 300;
      const row = this.closest<HTMLElement>(".draw-object");
      if (this.classList.contains("draw-objects-scroll")) {
        top = -1000;
        height = 100000;
      } else if (row !== null) {
        top = Number(row.dataset.index) * ROW_PX;
        height = ROW_PX;
        if (this.classList.contains("draw-object-twisty")) {
          left = 12 + (Number(row.getAttribute("aria-level")) - 1) * 20;
          width = 20;
        }
      }
      return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
    });
  }

  function pointer(type: string, target: Element, y: number, init: PointerEventInit = {}): PointerEvent {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 100, clientY: y, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("Alt con le frecce porta la riga attiva di un passo: oltre un gruppo chiuso, dentro uno aperto, fuori dal gruppo, nel livello accanto", () => {
    mountMoving(["d"]);
    tree.focus();
    expect(active()?.dataset.key).toBe("d");
    // Giù, cioè dietro: oltre il gruppo chiuso.
    key("ArrowDown", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["d"], { key: "g", place: "after" }]);
    // Davanti a tutto nel livello più alto: più su non va, e lo si dice.
    key("ArrowUp", { altKey: true });
    expect(edges).toEqual(["d front"]);
    // Un gruppo aperto si attraversa: ci si entra dal suo bordo.
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("d");
    key("ArrowDown", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["d"], { key: "g", place: "top" }]);
    // Al bordo di un gruppo se ne esce, davanti o dietro a lui.
    key("ArrowDown");
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("g2");
    key("ArrowUp", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["g2"], { key: "g", place: "before" }]);
    key("ArrowDown");
    key("ArrowDown", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["g1"], { key: "g", place: "after" }]);
    // Al bordo di un livello si va nel livello accanto, dal suo bordo vicino.
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("b");
    key("ArrowDown", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["b"], { key: "l1", place: "top" }]);
    key("End");
    key("ArrowDown", { altKey: true });
    expect(edges).toEqual(["d front", "a back"]);
    // Un livello va fra i livelli.
    key("ArrowUp");
    expect(active()?.dataset.key).toBe("l1");
    key("ArrowUp", { altKey: true });
    expect(moves[moves.length - 1]).toEqual([["l1"], { key: "l2", place: "before" }]);
    key("ArrowDown", { altKey: true });
    expect(edges).toEqual(["d front", "a back", "l1 back"]);
    // Il tasto è dell'albero: l'editor non lo sente.
    expect(key("ArrowUp", { altKey: true }).defaultPrevented).toBe(true);
  });

  it("senza chi sposta, Alt e le frecce scorrono le righe come sempre", () => {
    mount(MOVABLE, ["d"]);
    tree.focus();
    key("ArrowDown", { altKey: true });
    expect(active()?.dataset.key).toBe("g");
  });

  it("trascinare una riga la porta sopra o sotto un'altra, e la sceglie; il clic che chiude il gesto non sceglie", () => {
    layout();
    mountMoving(["b"]);
    pointer("pointerdown", labelOf("d"), ROW_PX + 10);
    // Meno di cinque pixel non sono un trascinamento.
    pointer("pointermove", treeEl(), ROW_PX + 12);
    expect(treeEl().hasAttribute("data-dragging")).toBe(false);
    // Sulla metà bassa di b: sotto, cioè dietro, alla profondità di b.
    pointer("pointermove", treeEl(), 3 * ROW_PX + 30);
    expect(treeEl().hasAttribute("data-dragging")).toBe(true);
    expect(chosen[chosen.length - 1]).toEqual(["d"]);
    expect(rowEl("d").hasAttribute("data-moving")).toBe(true);
    expect(rowEl("b").dataset.drop).toBe("after");
    expect(depthOf("b")).toBe("1");
    const ghost = host.querySelector<HTMLElement>(".draw-objects-ghost")!;
    expect(ghost.textContent).toBe("Oggetto d");
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    // Sulla metà alta: sopra.
    pointer("pointermove", treeEl(), 3 * ROW_PX + 10);
    expect(rowEl("b").dataset.drop).toBe("before");
    expect(host.querySelectorAll("[data-drop]")).toHaveLength(1);
    pointer("pointerup", treeEl(), 3 * ROW_PX + 10, { buttons: 0 });
    expect(moves).toEqual([[["d"], { key: "b", place: "before" }]]);
    expect(host.querySelector(".draw-objects-ghost")).toBeNull();
    expect(treeEl().hasAttribute("data-dragging")).toBe(false);
    expect(host.querySelector("[data-drop], [data-moving]")).toBeNull();
    const before = chosen.length;
    labelOf("b").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen).toHaveLength(before);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("su un gruppo chiuso lo contorna e, fermi, lo apre; sotto l'ultima riga di un gruppo, più a sinistra se ne esce", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    layout();
    mountMoving(["d"]);
    pointer("pointerdown", labelOf("d"), ROW_PX + 10);
    pointer("pointermove", treeEl(), 2 * ROW_PX + 22);
    expect(rowEl("g").dataset.drop).toBe("inside");
    expect(rowEl("g").getAttribute("aria-expanded")).toBe("false");
    vi.advanceTimersByTime(600);
    // Aperto: la linea sotto di lui, rientrata come i suoi figli.
    expect(rowEl("g").getAttribute("aria-expanded")).toBe("true");
    expect(rowEl("g").dataset.drop).toBe("after");
    expect(depthOf("g")).toBe("2");
    // Dal davanti: l2, d, g, g2, g1, b. Sotto g1, sul suo nome resta nel gruppo.
    pointer("pointermove", treeEl(), 4 * ROW_PX + 40);
    expect(rowEl("g1").dataset.drop).toBe("after");
    expect(depthOf("g1")).toBe("2");
    // Più a sinistra della sua freccia, dietro al gruppo.
    pointer("pointermove", treeEl(), 4 * ROW_PX + 40, { clientX: 40 });
    expect(depthOf("g1")).toBe("1");
    pointer("pointerup", treeEl(), 4 * ROW_PX + 40, { clientX: 40, buttons: 0 });
    expect(moves).toEqual([[["d"], { key: "g", place: "after" }]]);
  });

  it("dove l'editor dice di no non c'è segno; mentre si trascina i tasti aspettano, e Esc lascia stare", () => {
    layout();
    mountMoving(["d"], { canMove: (_keys, drop) => drop.key !== "a" });
    pointer("pointerdown", labelOf("d"), ROW_PX + 10);
    pointer("pointermove", treeEl(), 5 * ROW_PX + 10);
    expect(treeEl().hasAttribute("data-refused")).toBe(true);
    expect(host.querySelector("[data-drop]")).toBeNull();
    pointer("pointermove", treeEl(), 3 * ROW_PX + 10);
    expect(treeEl().hasAttribute("data-refused")).toBe(false);
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(active()?.dataset.key).toBe("d");
    key("Escape");
    expect(treeEl().hasAttribute("data-dragging")).toBe(false);
    expect(host.querySelector(".draw-objects-ghost, [data-drop]")).toBeNull();
    pointer("pointerup", treeEl(), 3 * ROW_PX + 10, { buttons: 0 });
    expect(moves).toEqual([]);
    expect(calls).not.toContain("leave");
  });

  it("un livello va da solo, sopra o sotto un altro livello intero, e non si sceglie", () => {
    layout();
    mountMoving(["d"]);
    pointer("pointerdown", labelOf("l1"), 4 * ROW_PX + 10);
    // Nella metà bassa di l2 con ciò che contiene: sotto l2.
    pointer("pointermove", treeEl(), 3 * ROW_PX + 30);
    expect(rowEl("b").dataset.drop).toBe("after");
    expect(depthOf("b")).toBe("0");
    expect(host.querySelector<HTMLElement>(".draw-objects-ghost")!.textContent).toBe("Livello l1");
    pointer("pointermove", treeEl(), 30);
    expect(rowEl("l2").dataset.drop).toBe("before");
    pointer("pointerup", treeEl(), 30, { buttons: 0 });
    expect(moves).toEqual([[["l1"], { key: "l2", place: "before" }]]);
    expect(chosen).toEqual([]);
  });

  it("una riga scelta porta con sé le altre scelte, in ordine di documento", () => {
    layout();
    mountMoving(["d", "a"]);
    pointer("pointerdown", labelOf("d"), ROW_PX + 10);
    pointer("pointermove", treeEl(), 3 * ROW_PX + 10);
    expect(host.querySelector<HTMLElement>(".draw-objects-ghost")!.textContent).toBe("2 oggetti");
    expect(rowEl("a").hasAttribute("data-moving")).toBe(true);
    pointer("pointerup", treeEl(), 3 * ROW_PX + 10, { buttons: 0 });
    expect(moves).toEqual([[["a", "d"], { key: "b", place: "before" }]]);
  });

  it("col dito la riga si solleva tenendola premuta; un dito che si muove prima scorre l'elenco", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    layout();
    mountMoving(["d"]);
    const touch = { pointerType: "touch" };
    pointer("pointerdown", labelOf("d"), ROW_PX + 10, touch);
    pointer("pointermove", treeEl(), ROW_PX + 26, touch);
    vi.advanceTimersByTime(400);
    expect(treeEl().hasAttribute("data-dragging")).toBe(false);
    pointer("pointerup", treeEl(), ROW_PX + 26, { ...touch, buttons: 0 });
    pointer("pointerdown", labelOf("d"), ROW_PX + 10, touch);
    // La pressione lunga non apre il menu del sistema.
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    treeEl().dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(400);
    expect(treeEl().hasAttribute("data-dragging")).toBe(true);
    // Sollevata, il dito non scorre più l'elenco.
    const swipe = new Event("touchmove", { bubbles: true, cancelable: true });
    treeEl().dispatchEvent(swipe);
    expect(swipe.defaultPrevented).toBe(true);
    pointer("pointermove", treeEl(), 3 * ROW_PX + 10, touch);
    pointer("pointerup", treeEl(), 3 * ROW_PX + 10, { ...touch, buttons: 0 });
    expect(moves).toEqual([[["d"], { key: "b", place: "before" }]]);
  });

  it("la riga attiva segue la voce spostata, anche con la chiave nuova, e ciò che ora la contiene si apre", () => {
    layout();
    const after = [layer("l1", [object("a")]), layer("l2", [group("g", [object("g1"), object("g2"), object("nb")]), object("d")])];
    mountMoving(["b"], {
      onMove: (keys, drop) => {
        moves.push([[...keys], drop]);
        tree.update(after, ["nb"], 5);
        return ["nb"];
      },
    });
    pointer("pointerdown", labelOf("b"), 3 * ROW_PX + 10);
    pointer("pointermove", treeEl(), 2 * ROW_PX + 22);
    pointer("pointerup", treeEl(), 2 * ROW_PX + 22, { buttons: 0 });
    expect(moves).toEqual([[["b"], { key: "g", place: "top" }]]);
    expect(active()?.dataset.key).toBe("nb");
    expect(rowEl("g").getAttribute("aria-expanded")).toBe("true");
    expect(rows().map((row) => row.dataset.key)).toEqual(["l2", "d", "g", "nb", "g2", "g1", "l1", "a"]);
  });
});

describe("le miniature", () => {
  let frames: Map<number, FrameRequestCallback>;
  let drawn: string[];
  let closed: string[];

  beforeEach(() => {
    frames = new Map();
    drawn = [];
    closed = [];
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++next, callback);
      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  /// Un fotogramma.
  const frame = (): void => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(0);
  };

  /// Un oggetto la cui miniatura mostra `look`; `null` se non ne ha una.
  function pictured(key: string, look: string | null): TreeEntry {
    return object(key, true, {
      thumbnail: () => look === null ? null : {
        key: look,
        draw: (thumbLife) => {
          drawn.push(`${key} ${look}`);
          thumbLife.add(() => closed.push(`${key} ${look}`));
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("data-look", look);
          return svg;
        },
      },
    });
  }

  const thumb = (key: string): HTMLElement => host.querySelector<HTMLElement>(`.draw-object[data-key="${key}"] .draw-object-thumb`)!;
  const look = (key: string): string | null => thumb(key).querySelector("svg")?.getAttribute("data-look") ?? null;

  it("si disegnano dopo, e restano finché non cambia ciò che mostrano", () => {
    mount([pictured("a", "1"), pictured("b", null), object("c")]);
    expect(drawn).toEqual([]);
    expect(look("a")).toBeNull();
    frame();
    expect(drawn).toEqual(["a 1"]);
    expect(look("a")).toBe("1");
    expect(thumb("a").hasAttribute("data-empty")).toBe(false);
    expect(thumb("a").getAttribute("aria-hidden")).toBe("true");
    // Senza niente da mostrare ne resta il posto; senza miniature, no.
    expect(thumb("b").hasAttribute("data-empty")).toBe(true);
    expect(thumb("b").hidden).toBe(false);
    expect(thumb("c").hidden).toBe(true);
    // Ciò che mostra è lo stesso: niente da rifare.
    tree.update([pictured("a", "1"), pictured("b", null), object("c")], [], 3);
    frame();
    expect(drawn).toEqual(["a 1"]);
    // È cambiato: la vecchia resta finché non c'è la nuova.
    tree.update([pictured("a", "2"), pictured("b", null), object("c")], [], 3);
    expect(look("a")).toBe("1");
    frame();
    expect(drawn).toEqual(["a 1", "a 2"]);
    expect(closed).toEqual(["a 1"]);
    expect(look("a")).toBe("2");
    // Una voce che se ne va si porta via la sua.
    tree.update([object("c")], [], 1);
    expect(closed).toEqual(["a 1", "a 2"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("qualche riga per fotogramma, e niente finché l'elenco non si vede", () => {
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    });
    // Ogni miniatura prende più del tempo dato a un fotogramma.
    vi.spyOn(performance, "now").mockImplementation(() => drawn.length * 7);
    mount([pictured("a", "1"), pictured("b", "1"), pictured("c", "1")]);
    const seen = (on: boolean): void => observers[0]!([{ isIntersecting: on } as IntersectionObserverEntry], {} as IntersectionObserver);
    seen(false);
    frame();
    expect(drawn).toEqual([]);
    seen(true);
    frame();
    expect(drawn).toEqual(["c 1"]);
    frame();
    expect(drawn).toEqual(["c 1", "b 1"]);
    frame();
    expect(drawn).toEqual(["c 1", "b 1", "a 1"]);
    expect(frames.size).toBe(0);
  });

  it(`oltre ${VIRTUAL_AFTER} righe le disegna solo per quelle disegnate`, () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(Array.from({ length: VIRTUAL_AFTER * 2 }, (_, index) => pictured(`o${index}`, "1")));
    frame();
    expect(drawn).toHaveLength(rows().length);
    expect(drawn.length).toBeLessThan(100);
  });
});
