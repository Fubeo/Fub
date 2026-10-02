// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../../i18n/strings";
import { closeContextMenu } from "../../../../ui/menu";
import { TableGrid, type TableGridHost } from "./table-grid";
import type { TableData } from "./table-model";

const grids: TableGrid[] = [];

afterEach(() => {
  closeContextMenu();
  for (const grid of grids.splice(0)) {
    grid.destroy();
    grid.element.remove();
  }
});

/// Una griglia con un host che scrive subito: la tabella nuova torna alla
/// griglia come farebbe l'editor dopo la transazione.
function mount(rows: string[][], readOnly = false) {
  const writes: TableData[] = [];
  const left: string[] = [];
  const undo = vi.fn();
  let grid: TableGrid | null = null;
  const host: TableGridHost = {
    write: (next) => {
      writes.push(next);
      grid?.update(next);
      return true;
    },
    readOnly: () => readOnly,
    undo,
    redo: vi.fn(),
    leave: (where) => void left.push(where),
    cellHtml: () => null,
    activate: () => false,
    focused: vi.fn(),
    changed: vi.fn(),
  };
  grid = new TableGrid(host, { rows, aligns: rows[0]!.map(() => null) });
  grids.push(grid);
  document.body.append(grid.element);
  const root = grid.element.querySelector<HTMLElement>(".cm-md-grid")!;
  const cell = (row: number, col: number) =>
    root.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)!;
  return { grid, root, cell, writes, left, undo };
}

function key(target: Element, name: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

function mouse(target: Element, type: string, init: MouseEventInit = {}): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}

const ROWS = [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]];

describe("la griglia", () => {
  it("disegna celle, lettere delle colonne e numeri delle righe", () => {
    const { root, cell } = mount(ROWS);
    expect(root.getAttribute("role")).toBe("grid");
    expect(cell(0, 0).textContent).toBe("Nome");
    expect(cell(2, 1).textContent).toBe("9");
    expect([...root.querySelectorAll(".cm-md-grid-letter")].map((el) => el.textContent)).toEqual(["A", "B"]);
    expect([...root.querySelectorAll(".cm-md-grid-rowhead")].map((el) => el.textContent)).toEqual(["1", "2", "3"]);
    expect(root.getAttribute("aria-activedescendant")).toBe(cell(0, 0).id);
  });

  it("le frecce muovono la cella attiva, e Maiusc allarga la selezione", () => {
    const { grid, root, cell } = mount(ROWS);
    grid.focus("first");
    key(root, "ArrowRight");
    expect(grid.selection.focus).toEqual({ row: 0, col: 1 });
    key(root, "ArrowDown", { shiftKey: true });
    expect(grid.selection).toEqual({ anchor: { row: 0, col: 1 }, focus: { row: 1, col: 1 } });
    expect(cell(0, 1).classList.contains("is-selected")).toBe(true);
    expect(cell(1, 1).classList.contains("is-active")).toBe(true);
    expect(cell(1, 0).classList.contains("is-selected")).toBe(false);
  });

  it("un carattere riscrive la cella, e Invio conferma scendendo", () => {
    const { grid, root, cell, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    key(root, "x");
    const input = cell(1, 0).querySelector("input")!;
    expect(input.value).toBe("x");
    input.value = "Xena";
    key(input, "Enter");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.rows[1]).toEqual(["Xena", "10"]);
    expect(cell(1, 0).textContent).toBe("Xena");
    expect(cell(1, 0).querySelector("input")).toBeNull();
    expect(grid.selection.focus).toEqual({ row: 2, col: 0 });
  });

  it("Escape annulla la modifica, e il testo resta quello di prima", () => {
    const { grid, root, cell, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 1 });
    key(root, "Enter");
    const input = cell(1, 1).querySelector("input")!;
    expect(input.value).toBe("10");
    input.value = "zzz";
    key(input, "Escape");
    expect(writes).toHaveLength(0);
    expect(cell(1, 1).textContent).toBe("10");
    expect(grid.editing).toBe(false);
  });

  it("con Invio le frecce laterali muovono il cursore; dopo un carattere confermano", () => {
    const { grid, root, cell, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    key(root, "Enter");
    key(cell(1, 0).querySelector("input")!, "ArrowLeft");
    expect(grid.editing).toBe(true);
    key(cell(1, 0).querySelector("input")!, "Escape");
    key(root, "q");
    key(cell(1, 0).querySelector("input")!, "ArrowRight");
    expect(grid.editing).toBe(false);
    expect(writes[0]!.rows[1]).toEqual(["q", "10"]);
    expect(grid.selection.focus).toEqual({ row: 1, col: 1 });
  });

  it("Tab dall'ultima cella aggiunge una riga e ci va", () => {
    const { grid, root, writes } = mount(ROWS);
    grid.focus({ row: 2, col: 1 });
    key(root, "Tab");
    expect(writes[0]!.rows).toHaveLength(4);
    expect(grid.selection.focus).toEqual({ row: 3, col: 0 });
    key(root, "Tab", { shiftKey: true });
    expect(grid.selection.focus).toEqual({ row: 2, col: 1 });
  });

  it("Canc svuota le celle selezionate", () => {
    const { grid, root, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    key(root, "ArrowRight", { shiftKey: true });
    key(root, "Delete");
    expect(writes[0]!.rows[1]).toEqual(["", ""]);
  });

  it("dai bordi e con Escape si torna al testo", () => {
    const { grid, root, left } = mount(ROWS);
    grid.focus("first");
    key(root, "ArrowUp");
    grid.focus("last");
    key(root, "ArrowDown");
    key(root, "Escape");
    expect(left).toEqual(["before", "after", "after"]);
  });

  it("Mod+Z chiede l'annulla all'editor", () => {
    const { grid, root, undo } = mount(ROWS);
    grid.focus("first");
    key(root, "z", { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("copia in TSV, e incollare oltre il bordo allarga la tabella", () => {
    const { grid, root, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    key(root, "ArrowRight", { shiftKey: true });
    const copied = { setData: vi.fn(), getData: () => "" };
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: copied });
    root.dispatchEvent(copy);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", "Ada\t10\n");

    grid.focus({ row: 2, col: 1 });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "X\tY" } });
    root.dispatchEvent(paste);
    expect(writes[0]!.rows).toEqual([["Nome", "Voto", ""], ["Ada", "10", ""], ["Bea", "X", "Y"]]);
    expect(grid.selection).toEqual({ anchor: { row: 2, col: 1 }, focus: { row: 2, col: 2 } });
  });

  it("una cella copiata da un foglio resta una cella, e il tab di una cella torna com'era", () => {
    const { grid, root, writes } = mount([["Nome", "Voto"], ["a\tb", "10"], ["Bea", "9"]]);
    grid.focus({ row: 1, col: 0 });
    const copied = { setData: vi.fn(), getData: () => "" };
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: copied });
    root.dispatchEvent(copy);
    expect(copied.setData).toHaveBeenCalledWith("text/plain", '"a\tb"\n');

    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      root.dispatchEvent(event);
    };
    paste('"a\tb"\n');
    expect(writes[writes.length - 1]!.rows).toEqual([["Nome", "Voto"], ["a\tb", "10"], ["Bea", "9"]]);
    // La cella `prima⏎seconda⇥terza` del foglio dell'app, o di Excel.
    paste('"prima\nseconda\tterza"\n');
    expect(writes[writes.length - 1]!.rows).toEqual([["Nome", "Voto"], ["prima\nseconda\tterza", "10"], ["Bea", "9"]]);
    expect(grid.selection).toEqual({ anchor: { row: 1, col: 0 }, focus: { row: 1, col: 0 } });
  });

  it("il clic sceglie la cella, Maiusc+clic il rettangolo, la lettera la colonna", () => {
    const { grid, root, cell } = mount(ROWS);
    mouse(cell(1, 0), "mousedown");
    expect(grid.selection.focus).toEqual({ row: 1, col: 0 });
    mouse(cell(2, 1), "mousedown", { shiftKey: true });
    expect(grid.selection).toEqual({ anchor: { row: 1, col: 0 }, focus: { row: 2, col: 1 } });
    mouse(root.querySelectorAll(".cm-md-grid-letter")[1]!, "mousedown");
    expect(grid.selection).toEqual({ anchor: { row: 0, col: 1 }, focus: { row: 2, col: 1 } });
  });

  it("il doppio clic modifica la cella col suo testo", () => {
    const { cell } = mount(ROWS);
    mouse(cell(2, 0), "dblclick");
    expect(cell(2, 0).querySelector("input")?.value).toBe("Bea");
  });

  it("il menu contestuale inserisce una riga sotto", () => {
    const { cell, writes } = mount(ROWS);
    mouse(cell(1, 0), "contextmenu", { button: 2 });
    const item = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((button) => button.textContent === t("table.menu.row_below"))!;
    item.click();
    expect(writes[0]!.rows).toHaveLength(4);
    expect(writes[0]!.rows[2]).toEqual(["", ""]);
  });

  it("in sola lettura si seleziona e si copia, ma non si scrive", () => {
    const { grid, root, cell, writes } = mount(ROWS, true);
    grid.focus({ row: 1, col: 0 });
    key(root, "x");
    expect(cell(1, 0).querySelector("input")).toBeNull();
    key(root, "Delete");
    expect(writes).toHaveLength(0);
    expect(grid.actionState("markdown.bold")).toEqual({ enabled: false, active: false });
    expect(grid.runAction("markdown.bold")).toBe(false);
  });
});

describe("le azioni della barra sulla griglia", () => {
  it("il grassetto avvolge le celle selezionate e si vede premuto", () => {
    const { grid, writes } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    expect(grid.actionState("markdown.bold")).toEqual({ enabled: true, active: false });
    expect(grid.runAction("markdown.bold")).toBe(true);
    expect(writes[0]!.rows[1]).toEqual(["**Ada**", "10"]);
    expect(grid.actionState("markdown.bold").active).toBe(true);
  });

  it("le operazioni di tabella valgono dove hanno senso, le altre sono spente", () => {
    const { grid } = mount(ROWS);
    grid.focus({ row: 1, col: 0 });
    expect(grid.actionState("markdown.table.row.up").enabled).toBe(false);
    expect(grid.actionState("markdown.table.row.down").enabled).toBe(true);
    expect(grid.actionState("markdown.heading.1")).toEqual({ enabled: false, active: null });
    expect(grid.actionState("markdown.table")).toEqual({ enabled: false, active: null });
    grid.focus({ row: 2, col: 0 });
    expect(grid.actionState("markdown.table.row.up").enabled).toBe(true);
  });

  it("eliminare una riga lascia la selezione su una riga che c'è", () => {
    const { grid, writes } = mount(ROWS);
    grid.focus({ row: 2, col: 1 });
    expect(grid.runAction("markdown.table.row.delete")).toBe(true);
    expect(writes[0]!.rows).toEqual([["Nome", "Voto"], ["Ada", "10"]]);
    expect(grid.selection.focus).toEqual({ row: 1, col: 1 });
  });
});
