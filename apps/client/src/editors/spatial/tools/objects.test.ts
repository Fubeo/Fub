// @vitest-environment happy-dom
// L'albero degli oggetti da solo: le righe, la tastiera del pattern ARIA,
// la selezione che segue il fuoco, e le righe disegnate oltre le 500.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { createObjectTree, ROW_PX, VIRTUAL_AFTER, type ObjectTree, type TreeEntry } from "./objects";

function object(key: string, selectable = true): TreeEntry {
  return { key, layer: false, selectable, children: [], label: () => `Oggetto ${key}` };
}

function layer(key: string, children: readonly TreeEntry[], state = ""): TreeEntry {
  return { key, layer: true, selectable: false, children, label: () => `Livello ${key}${state}` };
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

function mount(entries: readonly TreeEntry[] = ENTRIES, selection: readonly string[] = []): ObjectTree {
  tree = createObjectTree(life, {
    onSelect: (keys) => {
      chosen.push([...keys]);
      tree.update(entries, keys, 5);
    },
    onActivate: () => calls.push("activate"),
    onDelete: () => calls.push("delete"),
    onLeave: () => calls.push("leave"),
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
});

describe("le righe", () => {
  it("dicono livello, posizione, scelta e stato, e non solo col colore", () => {
    mount(ENTRIES, ["c"]);
    expect(treeEl().getAttribute("aria-multiselectable")).toBe("true");
    expect(treeEl().getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    expect(host.querySelector("h2")!.textContent).toBe("Oggetti");
    expect(host.querySelector(".draw-objects-count")!.textContent).toBe("5 oggetti");
    expect(rows().map((row) => [row.textContent, row.getAttribute("aria-level"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")])).toEqual([
      ["▾Livello l1, bloccato", "1", "1", "3"],
      ["✓Oggetto a", "2", "1", "1"],
      ["▾Livello l2", "1", "2", "3"],
      ["✓Oggetto b", "2", "1", "3"],
      ["✓Oggetto c", "2", "2", "3"],
      ["✓Oggetto d", "2", "3", "3"],
      ["✓Oggetto e", "1", "3", "3"],
    ]);
    // Il segno è nascosto agli screen reader: per loro c'è `aria-selected`.
    expect(rows()[0]!.querySelector(".draw-object-mark")!.getAttribute("aria-hidden")).toBe("true");
    expect(rows()[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(rows()[0]!.hasAttribute("aria-selected")).toBe(false);
    expect(rows()[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual([null, "false", null, "false", "true", "false", "false"]);
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
    expect(rows()[3]!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("la tastiera", () => {
  it("le frecce scelgono la riga a cui arrivano; un livello non sceglie niente", () => {
    mount();
    tree.focus();
    expect(active()?.dataset.key).toBe("l1");
    key("ArrowDown");
    // Un oggetto di un livello bloccato non si sceglie.
    expect(chosen.pop()).toEqual([]);
    key("ArrowDown");
    expect(active()?.dataset.key).toBe("l2");
    key("ArrowDown");
    expect(chosen.pop()).toEqual(["b"]);
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    key("End");
    expect(chosen.pop()).toEqual(["e"]);
    key("Home");
    expect(active()?.dataset.key).toBe("l1");
  });

  it("Ctrl sposta soltanto, Spazio aggiunge e toglie, Maiusc estende", () => {
    mount();
    tree.focus();
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown");
    expect(chosen.pop()).toEqual(["b"]);
    key("ArrowDown", { ctrlKey: true });
    key("ArrowDown", { ctrlKey: true });
    expect(chosen).toHaveLength(2);
    expect(active()?.dataset.key).toBe("d");
    key(" ");
    expect(chosen.pop()).toEqual(["b", "d"]);
    key(" ");
    expect(chosen.pop()).toEqual(["b"]);
    key("ArrowUp", { shiftKey: true });
    expect(chosen.pop()).toEqual(["c", "d"]);
    key("a", { ctrlKey: true });
    expect(chosen.pop()).toEqual(["b", "c", "d", "e"]);
  });

  it("le frecce laterali aprono, chiudono e salgono al livello", () => {
    mount();
    tree.focus();
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowLeft");
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "a", "l2", "e"]);
    expect(rows()[2]!.getAttribute("aria-expanded")).toBe("false");
    expect(rows()[2]!.querySelector(".draw-object-mark")!.textContent).toBe("▸");
    key("ArrowRight");
    expect(rows()).toHaveLength(7);
    key("ArrowRight");
    expect(active()?.dataset.key).toBe("b");
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
    key("End");
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
    expect(rows().map((row) => row.dataset.key)).toEqual(["l1", "a", "l2", "e"]);
    host.querySelector('[data-key="e"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(calls).toEqual(["activate"]);
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
    expect(chosen.pop()).toEqual(["o1999"]);
    expect(active()?.dataset.key).toBe("o1999");
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
