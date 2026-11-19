// @vitest-environment happy-dom
// La scelta di più note nell'albero: Ctrl, Maiusc, tastiera, ciò che sparisce
// dal DOM esce dalla scelta, e i gesti della barra.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { mountTreeSelection, type TreeSelection } from "./explorer-selection";

let list: HTMLElement;
let life: Lifetime;
let sel: TreeSelection;
let trash: ReturnType<typeof vi.fn<(paths: string[]) => Promise<boolean | void>>>;
let move: ReturnType<typeof vi.fn<(paths: string[]) => Promise<boolean | void>>>;
let group: ReturnType<typeof vi.fn<(paths: string[]) => Promise<boolean | void>>>;
let copy: ReturnType<typeof vi.fn<(paths: string[]) => void>>;
let copyLinks: ReturnType<typeof vi.fn<(paths: string[]) => Promise<unknown>>>;
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
  trash = vi.fn(async (_paths: string[]): Promise<boolean | void> => true);
  move = vi.fn(async (_paths: string[]): Promise<boolean | void> => {});
  group = vi.fn(async (_paths: string[]): Promise<boolean | void> => {});
  copy = vi.fn((_paths: string[]) => {});
  copyLinks = vi.fn(async (_paths: string[]) => {});
  current = null;
  build(["a.md", "b.md", "c.md", "d.md", "dir/"]);
  sel = mountTreeSelection({ list, currentDoc: () => current, trash, move, group, copy, copyLinks, lifetime: life });
});
afterEach(() => life.close());

describe("scelta multipla dell'albero", () => {
  it("la barra compare sotto l'albero: nessuna riga scappa da sotto il puntatore (IMP-010)", () => {
    const bar = document.querySelector<HTMLElement>(".tree-selection")!;
    // Prima di ogni riga non c'è niente che compaia: il primo Ctrl-clic non
    // sposta la riga dopo, e il secondo Ctrl-clic la prende.
    expect(list.previousElementSibling).toBeNull();
    expect(list.nextElementSibling).toBe(bar);
    click("b.md", { ctrlKey: true });
    expect(bar.hidden).toBe(false);
    click("c.md", { ctrlKey: true });
    expect(sel.paths()).toEqual(["b.md", "c.md"]);
    expect(bar.querySelector(".tree-selection-count")!.textContent).toBe("2 scelte");
  });

  it("il tasto destro su una nota scelta con altre dà i gesti del gruppo, per tutte", async () => {
    expect(sel.menuFor("a.md"), "una nota sola ha il suo menu").toBeNull();
    click("a.md", { ctrlKey: true });
    expect(sel.menuFor("a.md"), "scelta da sola, è ancora una nota").toBeNull();
    click("b.md", { ctrlKey: true });
    expect(sel.menuFor("c.md"), "fuori dalla scelta vale il menu della nota").toBeNull();
    const { items: menu, searchable } = sel.menuFor("b.md")!;
    expect(menu.map((item) => item.label)).toEqual(["Sposta in…", "In una cartella nuova…", "Copia i link", "Sposta nel cestino"]);
    expect(searchable.map((item) => item.label), "il resto si trova scrivendo").toEqual(["Copia i file", "Deseleziona"]);
    expect(menu[menu.length - 1]!.danger, "il pericoloso per ultimo").toBe(true);
    expect(menu.some((item) => item.hint), "Canc nell'albero cestina la nota del fuoco, non la scelta: nessun accordo promesso").toBe(false);
    expect(menu.some((item) => item.label === "Rinomina"), "rinominare è di una nota sola").toBe(false);
    menu[2]!.run!();
    expect(copyLinks).toHaveBeenCalledWith(["a.md", "b.md"]);
    searchable[0]!.run!();
    expect(copy).toHaveBeenCalledWith(["a.md", "b.md"]);
    menu[menu.length - 1]!.run!();
    await vi.waitFor(() => expect(trash).toHaveBeenCalledWith(["a.md", "b.md"]));
  });

  it("con l'esportazione, la scelta va in un PDF solo nell'ordine in cui si è scelta (T78)", () => {
    life.close();
    life = openLifetime();
    const exportPdf = vi.fn(async (_paths: string[]) => {});
    sel = mountTreeSelection({ list, currentDoc: () => current, trash, move, group, copy, copyLinks, exportPdf, lifetime: life });
    click("c.md", { ctrlKey: true });
    click("a.md", { ctrlKey: true });
    const { items: menu } = sel.menuFor("a.md")!;
    expect(menu.map((item) => item.label)).toEqual(["Sposta in…", "In una cartella nuova…", "Copia i link", "Esporta in PDF…", "Sposta nel cestino"]);
    menu[3]!.run!();
    expect(exportPdf).toHaveBeenCalledWith(["c.md", "a.md"]);
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

  it("un gesto prende la scelta quando parte: mentre va, la barra non la offre più (IMP-1803)", async () => {
    let finish!: () => void;
    move.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    click("a.md", { ctrlKey: true });
    click("b.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.click();
    expect(move).toHaveBeenCalledWith(["a.md", "b.md"]);
    expect(sel.paths(), "le note in viaggio non sono più scelte").toEqual([]);
    expect(document.querySelector<HTMLElement>(".tree-selection")!.hidden).toBe(true);

    // Mentre lo spostamento va, si sceglie un'altra nota: la fine del primo
    // gesto non la cancella, e il secondo gesto porta solo lei.
    click("c.md", { ctrlKey: true });
    finish();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(sel.paths()).toEqual(["c.md"]);
    document.querySelector<HTMLButtonElement>(".tree-selection-group")!.click();
    expect(group).toHaveBeenCalledWith(["c.md"]);
  });

  it("un gesto annullato rende la scelta, senza le voci sparite nel frattempo", async () => {
    let cancel!: (value: boolean) => void;
    move.mockImplementationOnce(() => new Promise<boolean>((resolve) => (cancel = resolve)));
    click("a.md", { ctrlKey: true });
    click("b.md", { ctrlKey: true });
    click("c.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.click();
    expect(sel.paths()).toEqual([]);
    build(["a.md", "c.md", "d.md", "dir/"]);
    sel.repaint();
    cancel(false);
    await vi.waitFor(() => expect(sel.paths()).toEqual(["a.md", "c.md"]));

    // Annullato dopo che si è scelto altro: vale la scelta nuova.
    move.mockImplementationOnce(() => new Promise<boolean>((resolve) => (cancel = resolve)));
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.click();
    click("d.md", { ctrlKey: true });
    cancel(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(sel.paths()).toEqual(["d.md"]);
  });

  it("una voce che il kernel dice sparita esce subito, con ciò che le stava sotto", () => {
    build(["a.md", "b.md", "dir/x.md", "dir/y.md"]);
    sel.repaint();
    for (const path of ["a.md", "b.md", "dir/x.md", "dir/y.md"]) click(path, { ctrlKey: true });
    sel.forget("a.md");
    expect(sel.paths()).toEqual(["b.md", "dir/x.md", "dir/y.md"]);
    sel.forget("dir");
    expect(sel.paths()).toEqual(["b.md"]);
    sel.forget("di");
    expect(sel.paths(), "un prefisso che non è una cartella non toglie niente").toEqual(["b.md"]);
    expect(document.querySelector(".tree-selection-count")!.textContent).toBe("1 scelte");
  });

  it("un gesto della barra premuto da tastiera riporta il fuoco nell'albero, non su body (IMP-154)", async () => {
    list.querySelectorAll<HTMLElement>("li").forEach((li) => (li.tabIndex = -1));
    list.querySelector<HTMLElement>('li[data-path="c.md"]')!.tabIndex = 0;
    click("a.md", { ctrlKey: true });
    click("b.md", { ctrlKey: true });
    const button = document.querySelector<HTMLButtonElement>(".tree-selection-trash")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    await vi.waitFor(() => expect(sel.paths()).toEqual([]));
    expect(document.activeElement).toBe(list.querySelector('li[data-path="c.md"]'));

    // Un fuoco che il gesto ha portato altrove (il selettore della cartella)
    // resta dov'è.
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    move.mockImplementationOnce(async () => elsewhere.focus());
    click("d.md", { ctrlKey: true });
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.focus();
    document.querySelector<HTMLButtonElement>(".tree-selection-move")!.click();
    await vi.waitFor(() => expect(sel.paths()).toEqual([]));
    expect(document.activeElement).toBe(elsewhere);
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
