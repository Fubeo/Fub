// @vitest-environment happy-dom
// La scelta di più note nell'albero: Ctrl, Maiusc, tastiera, ciò che sparisce
// dal DOM esce dalla scelta, e i gesti della barra.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { mountTreeSelection, type TreeSelection } from "./explorer-selection";

let list: HTMLElement;
let life: Lifetime;
let sel: TreeSelection;
let trash: ReturnType<typeof vi.fn<(paths: string[]) => Promise<unknown>>>;
let move: ReturnType<typeof vi.fn<(paths: string[]) => Promise<unknown>>>;
let group: ReturnType<typeof vi.fn<(paths: string[]) => Promise<unknown>>>;
let copy: ReturnType<typeof vi.fn<(paths: string[]) => void>>;
let current: string | null;

function build(paths: string[]): void {
  list.innerHTML = "";
  for (const path of paths) {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.dataset.path = path;
    const row = document.createElement("div");
    row.className = path.endsWith("/") ? "tree-row folder" : "tree-row note";
    li.append(row);
    list.append(li);
  }
}
const row = (path: string): HTMLElement => list.querySelector<HTMLElement>(`li[data-path="${path}"] > .tree-row`)!;
const click = (path: string, init: MouseEventInit = {}): MouseEvent => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  row(path).dispatchEvent(event);
  return event;
};

beforeEach(() => {
  document.body.innerHTML = '<div id="host"><ul id="list"></ul></div>';
  list = document.getElementById("list")!;
  life = openLifetime();
  trash = vi.fn(async (_paths: string[]) => 0);
  move = vi.fn(async (_paths: string[]) => {});
  group = vi.fn(async (_paths: string[]) => {});
  copy = vi.fn((_paths: string[]) => {});
  current = null;
  build(["a.md", "b.md", "c.md", "d.md", "dir/"]);
  sel = mountTreeSelection({ list, currentDoc: () => current, trash, move, group, copy, lifetime: life });
});
afterEach(() => life.close());

describe("scelta multipla dell'albero", () => {
  it("il tasto destro su una nota scelta con altre dà i gesti del gruppo, per tutte", async () => {
    expect(sel.menuFor("a.md"), "una nota sola ha il suo menu").toBeNull();
    click("a.md", { ctrlKey: true });
    expect(sel.menuFor("a.md"), "scelta da sola, è ancora una nota").toBeNull();
    click("b.md", { ctrlKey: true });
    expect(sel.menuFor("c.md"), "fuori dalla scelta vale il menu della nota").toBeNull();
    const menu = sel.menuFor("b.md")!;
    expect(menu.map((item) => item.label)).toEqual(["Copia", "Sposta in…", "In una cartella nuova", "Deseleziona", "Sposta nel cestino"]);
    expect(menu[menu.length - 1]!.danger, "il pericoloso per ultimo").toBe(true);
    expect(menu.some((item) => item.hint), "Canc nell'albero cestina la nota del fuoco, non la scelta: nessun accordo promesso").toBe(false);
    expect(menu.some((item) => item.label === "Rinomina"), "rinominare è di una nota sola").toBe(false);
    menu[0]!.run!();
    expect(copy).toHaveBeenCalledWith(["a.md", "b.md"]);
    menu[menu.length - 1]!.run!();
    await vi.waitFor(() => expect(trash).toHaveBeenCalledWith(["a.md", "b.md"]));
  });

  it("Ctrl-clic aggiunge e toglie, e non apre la nota", () => {
    const opened = vi.fn();
    list.addEventListener("click", opened);
    expect(click("a.md", { ctrlKey: true }).defaultPrevented).toBe(true);
    click("c.md", { metaKey: true });
    expect(sel.paths().sort()).toEqual(["a.md", "c.md"]);
    expect(list.querySelector('[data-path="a.md"]')!.getAttribute("aria-selected")).toBe("true");
    click("a.md", { ctrlKey: true });
    expect(sel.paths()).toEqual(["c.md"]);
    expect(list.querySelector('[data-path="a.md"]')!.hasAttribute("aria-selected")).toBe(false);
    expect(opened).not.toHaveBeenCalled();
  });

  it("Maiusc-clic sceglie l'intervallo fra le note, saltando le cartelle", () => {
    click("a.md", { ctrlKey: true });
    click("c.md", { shiftKey: true });
    expect(sel.paths().sort()).toEqual(["a.md", "b.md", "c.md"]);
    click("a.md", { shiftKey: true });
    expect(sel.paths()).toEqual(["a.md"]);
  });

  it("le cartelle non si scelgono", () => {
    click("dir/", { ctrlKey: true });
    expect(sel.paths()).toEqual([]);
  });

  it("un clic semplice azzera la scelta e lascia passare il clic", () => {
    click("a.md", { ctrlKey: true });
    const reached = vi.fn();
    list.addEventListener("click", reached);
    expect(click("b.md").defaultPrevented).toBe(false);
    expect(sel.paths()).toEqual([]);
    expect(reached).toHaveBeenCalled();
  });

  it("Ctrl-Spazio sceglie da tastiera, Esc azzera", () => {
    row("b.md").dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(sel.paths()).toEqual(["b.md"]);
    row("b.md").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(sel.paths()).toEqual([]);
  });

  it("la barra dice quante sono e si nasconde a scelta vuota", () => {
    const bar = document.querySelector<HTMLElement>(".tree-selection")!;
    expect(bar.hidden).toBe(true);
    click("a.md", { ctrlKey: true });
    click("b.md", { ctrlKey: true });
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector(".tree-selection-count")!.textContent).toContain("2");
  });

  it("ciò che esce dal DOM esce dalla scelta", () => {
    click("a.md", { ctrlKey: true });
    click("b.md", { ctrlKey: true });
    build(["b.md", "c.md"]);
    sel.repaint();
    expect(sel.paths()).toEqual(["b.md"]);
  });

  it("«Cestina» e «Sposta» passano le note scelte e poi svuotano la scelta", async () => {
    click("a.md", { ctrlKey: true });
    click("c.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-trash")!.click();
    await vi.waitFor(() => expect(trash).toHaveBeenCalledWith(["a.md", "c.md"]));
    await vi.waitFor(() => expect(sel.paths()).toEqual([]));
    click("b.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.click();
    await vi.waitFor(() => expect(move).toHaveBeenCalledWith(["b.md"]));
    click("a.md", { ctrlKey: true });
    click("d.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-group")!.click();
    await vi.waitFor(() => expect(group).toHaveBeenCalledWith(["a.md", "d.md"]));
    await vi.waitFor(() => expect(sel.paths()).toEqual([]));
  });

  it("la riga della nota aperta resta selezionata quando esce dalla scelta", () => {
    current = "a.md";
    list.querySelector('[data-path="a.md"]')!.setAttribute("aria-selected", "true");
    click("a.md", { ctrlKey: true });
    click("a.md", { ctrlKey: true });
    expect(list.querySelector('[data-path="a.md"]')!.getAttribute("aria-selected")).toBe("true");
  });

  it("allo smontaggio toglie la barra e il segno sulla lista", () => {
    life.close();
    expect(document.querySelector(".tree-selection")).toBeNull();
    expect(list.hasAttribute("aria-multiselectable")).toBe(false);
  });
});
