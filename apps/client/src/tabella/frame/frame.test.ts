// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableCaps, TableClipboard, TableEdit, TableMenuEntry } from "../adapter";
import { caseApplies, expectedOf, playCase, seenOf, TABLE_CONFORMANCE, type ConformanceClipboard, type ConformanceTarget } from "../conformance";
import { sortOrder } from "../sort";
import { fillRange } from "../selection";
import { columnName, TableFrame, type TableFrameHost } from "./frame";

const frames: TableFrame[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) {
    frame.destroy();
    frame.element.remove();
  }
});

const ALL: TableCaps = {
  insertRows: true,
  deleteRows: true,
  moveRows: true,
  insertColumns: true,
  deleteColumns: true,
  moveColumns: true,
  sort: true,
  align: true,
  merge: false,
  headerRows: 1,
};

/// Una tabella in memoria che fa ogni `TableEdit`: l'adattatore più semplice.
function apply(rows: string[][], edit: TableEdit, headerRows: number): void {
  const width = rows[0]?.length ?? 0;
  const empty = (n: number) => Array.from({ length: n }, () => "");
  switch (edit.kind) {
    case "set":
      for (const block of edit.blocks) {
        block.rows.forEach((line, i) => line.forEach((value, j) => {
          const r = block.row + i;
          const c = block.column + j;
          while (rows.length <= r) rows.push(empty(rows[0]?.length ?? 0));
          if (c >= (rows[0]?.length ?? 0)) for (const row of rows) row.push(...empty(c + 1 - row.length));
          rows[r]![c] = value;
        }));
      }
      break;
    case "clear":
      for (let r = edit.range.r0; r <= edit.range.r1; r++) for (let c = edit.range.c0; c <= edit.range.c1; c++) rows[r]![c] = "";
      break;
    case "insert-rows": rows.splice(edit.at, 0, ...Array.from({ length: edit.count }, () => empty(width))); break;
    case "delete-rows": rows.splice(edit.from, edit.to - edit.from + 1); break;
    case "move-rows": {
      const moved = rows.splice(edit.from, edit.to - edit.from + 1);
      rows.splice(edit.from + edit.by, 0, ...moved);
      break;
    }
    case "insert-columns": for (const row of rows) row.splice(edit.at, 0, ...empty(edit.count)); break;
    case "delete-columns": for (const row of rows) row.splice(edit.from, edit.to - edit.from + 1); break;
    case "move-columns":
      for (const row of rows) {
        const moved = row.splice(edit.from, edit.to - edit.from + 1);
        row.splice(edit.from + edit.by, 0, ...moved);
      }
      break;
    case "sort": {
      const body = rows.slice(headerRows);
      const order = sortOrder(body.map((row) => row[edit.column] ?? ""), edit.direction);
      rows.splice(headerRows, body.length, ...order.map((index) => body[index]!));
      break;
    }
    default: break;
  }
}

function mount(initial: string[][], options: { readOnly?: boolean; caps?: TableCaps } = {}) {
  const rows = initial.map((row) => [...row]);
  const caps = options.caps ?? ALL;
  const edits: TableEdit[] = [];
  const menus: TableMenuEntry[][] = [];
  const copied: TableClipboard[] = [];
  const left: string[] = [];
  let frame: TableFrame | null = null;
  const host: TableFrameHost = {
    size: () => ({ rows: rows.length, columns: rows[0]?.length ?? 0 }),
    caps: () => caps,
    cellText: (row, column) => rows[row]?.[column] ?? "",
    readOnly: () => options.readOnly ?? false,
    apply: (edit) => {
      edits.push(edit);
      apply(rows, edit, caps.headerRows);
      frame?.update();
      return true;
    },
    undo: vi.fn(),
    redo: vi.fn(),
    leave: (where) => void left.push(where),
    openMenu: (entries) => void menus.push([...entries]),
    writeClipboard: async (data) => void copied.push(data),
  };
  frame = new TableFrame(host);
  frames.push(frame);
  document.body.append(frame.element);
  const grid = frame.element.querySelector<HTMLElement>(".tb-grid")!;
  const cell = (row: number, column: number) => grid.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${column}"]`)!;
  return { frame, grid, cell, rows, edits, menus, copied, left };
}

function key(name: string, init: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

const ROWS = [["Nome", "Voto"], ["Ada", "10"], ["Bea", "9"]];

describe("la cornice della Tabella", () => {
  it("disegna le lettere, i numeri e le celle, con le classi della Tabella", () => {
    const { frame, grid, cell } = mount(ROWS);
    expect(frame.element.classList.contains("tb-frame")).toBe(true);
    expect([...grid.querySelectorAll(".tb-letter")].map((el) => el.textContent)).toEqual(["A", "B"]);
    expect([...grid.querySelectorAll(".tb-rowhead")].map((el) => el.textContent)).toEqual(["1", "2", "3"]);
    expect(cell(0, 0).tagName).toBe("TH");
    expect(cell(1, 1).textContent).toBe("10");
  });

  it("il menu nasce dalle capacità: senza unire non ci sono le celle unite", () => {
    const { frame } = mount(ROWS);
    const ids = frame.menu().map((entry) => entry.id);
    expect(ids).toContain("markdown.table.row.after");
    expect(ids).toContain("table.align.center");
    expect(ids).not.toContain("rich.table.merge");
    const bare = mount(ROWS, { caps: { ...ALL, sort: false, align: false } }).frame.menu().map((entry) => entry.id);
    expect(bare).not.toContain("markdown.table.sort.ascending");
    expect(bare).not.toContain("table.align.center");
  });

  it("il tasto Menu apre il menu come dati, sotto la cella attiva", () => {
    const { frame, menus } = mount(ROWS);
    frame.focus({ row: 1, column: 0 });
    key("ContextMenu");
    expect(menus).toHaveLength(1);
    expect(menus[0]!.find((entry) => entry.id === "markdown.table.row.before")?.disabled).toBe(false);
  });

  it("in sola lettura le voci che scrivono sono spente e nessun tasto scrive", () => {
    const { frame, edits } = mount(ROWS, { readOnly: true });
    frame.focus({ row: 1, column: 0 });
    key("Delete");
    key("x");
    expect(edits).toEqual([]);
    expect(frame.menu().filter((entry) => !entry.disabled).map((entry) => entry.id)).toEqual(["table.copy"]);
  });

  it("riempie la serie verso il basso e verso sinistra", () => {
    const { frame, rows } = mount([["N", "M"], ["1", "a"], ["2", "b"], ["", ""], ["", ""]]);
    expect(frame.fill({ r0: 1, c0: 0, r1: 2, c1: 0 }, { r0: 1, c0: 0, r1: 4, c1: 0 })).toBe(true);
    expect(rows.map((row) => row[0])).toEqual(["N", "1", "2", "3", "4"]);
    expect(frame.range).toEqual({ r0: 1, c0: 0, r1: 4, c1: 0 });
    const side = mount([["", "", "Voce 3"]]);
    side.frame.fill({ r0: 0, c0: 2, r1: 0, c1: 2 }, { r0: 0, c0: 0, r1: 0, c1: 2 });
    expect(side.rows[0]).toEqual(["Voce 1", "Voce 2", "Voce 3"]);
  });

  it("la maniglia segue l'asse più lungo e non riempie dentro la selezione", () => {
    const source = { r0: 1, c0: 1, r1: 2, c1: 1 };
    expect(fillRange(source, { row: 5, column: 2 })).toEqual({ r0: 1, c0: 1, r1: 5, c1: 1 });
    expect(fillRange(source, { row: 2, column: 4 })).toEqual({ r0: 1, c0: 1, r1: 2, c1: 4 });
    expect(fillRange(source, { row: 2, column: 1 })).toBeNull();
  });

  it("incolla un valore su tutta la selezione, e un blocco dall'angolo in alto a sinistra", () => {
    const { frame, grid, rows } = mount([["a", "b"], ["c", "d"], ["e", "f"]]);
    frame.focus({ row: 1, column: 0 });
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? text : "") } });
      grid.dispatchEvent(event);
    };
    paste("x");
    expect(rows).toEqual([["a", "b"], ["x", "x"], ["x", "x"]]);
    frame.focus({ row: 0, column: 0 });
    paste("1\t2\n3\t4");
    expect(rows).toEqual([["1", "2"], ["3", "4"], ["x", "x"]]);
    expect(frame.range).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
  });

  it("copia dal menu scrive il TSV e la tabella HTML", async () => {
    const { frame, copied } = mount(ROWS);
    frame.focus({ row: 1, column: 0 });
    key("ArrowRight", { shiftKey: true });
    frame.menu().find((entry) => entry.id === "table.copy")!.run();
    await Promise.resolve();
    expect(copied[0]?.text).toBe("Ada\t10\n");
    expect(copied[0]?.html).toContain("<table");
  });

  it("i «+» aggiungono una riga e una colonna in fondo", () => {
    const { frame, rows } = mount(ROWS);
    frame.element.querySelector<HTMLButtonElement>('.tb-add[data-add="column"]')!.click();
    expect(rows[0]).toEqual(["Nome", "Voto", ""]);
    expect(frame.selection.focus).toEqual({ row: 0, column: 2 });
    frame.element.querySelector<HTMLButtonElement>('.tb-add[data-add="row"]')!.click();
    expect(rows).toHaveLength(4);
  });

  it("smontata non lascia ascoltatori vivi", () => {
    const { frame, edits } = mount(ROWS);
    frame.focus({ row: 1, column: 0 });
    key("Enter");
    frame.destroy();
    key("Escape");
    key("Delete");
    expect(edits).toEqual([]);
  });

  it("un cambio da fuori toglie il segno del taglio; un ridisegno senza cambi no", () => {
    const { frame, rows, edits } = mount([["Nome", "Voto"], ["", ""], ["", ""], ["Bea", "9"]]);
    const store = { text: "", html: "" };
    frame.focus({ row: 1, column: 0 });
    clipboardEvent("cut", store);
    expect(frame.cutRange).toEqual({ r0: 1, c0: 0, r1: 1, c1: 0 });
    frame.update();
    expect(frame.cutRange).toEqual({ r0: 1, c0: 0, r1: 1, c1: 0 });
    // Un annulla da fuori toglie la riga: al posto del segno ora c'è un'altra
    // cella vuota, che l'incolla non deve spostare.
    rows.splice(1, 1);
    frame.update();
    expect(frame.cutRange).toBeNull();
    frame.focus({ row: 2, column: 0 });
    clipboardEvent("paste", store);
    expect(edits.every((edit) => edit.kind !== "set" || edit.blocks.length === 1)).toBe(true);
  });

  it("un taglio che incollato uscirebbe dalla tabella non sposta: è un incolla qualunque", () => {
    const { frame, rows } = mount(ROWS);
    const store = { text: "", html: "" };
    frame.focus({ row: 1, column: 0 });
    key("ArrowDown", { shiftKey: true });
    clipboardEvent("cut", store);
    frame.focus({ row: 2, column: 1 });
    clipboardEvent("paste", store);
    // Le celle tagliate restano: nessuna cella svuotata.
    expect(rows[1]).toEqual(["Ada", "10"]);
    expect(rows[2]![0]).toBe("Bea");
  });

  it("dà i nomi delle colonne dei fogli di calcolo", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });
});

/// Un evento degli appunti sul fuoco, con gli appunti finti della prova.
function clipboardEvent(kind: "cut" | "copy" | "paste", store: ConformanceClipboard): void {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, value: string) => {
        if (type === "text/plain") store.text = value;
        if (type === "text/html") store.html = value;
      },
      getData: (type: string) => (type === "text/plain" ? store.text : type === "text/html" ? store.html : ""),
    },
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
}

describe("la prova comune, sulla cornice", () => {
  const target: ConformanceTarget = { mode: "sheet", caps: ALL, bounded: true, delegates: false };
  for (const test of TABLE_CONFORMANCE) {
    it.runIf(caseApplies(test, target))(test.name, async () => {
      const { frame, rows } = mount(test.rows.map((row) => [...row]));
      frame.focus("first");
      const seen = await playCase(test, {
        key: (name, init) => key(name, init),
        command: (id) => void frame.runCommand(id),
        clipboard: clipboardEvent,
        cells: () => rows.map((row) => [...row]),
        active: () => frame.active,
        range: () => frame.range,
        cut: () => frame.cutRange,
        ranges: () => frame.ranges.length,
      });
      const expected = expectedOf(test, target);
      expect(seenOf(seen, expected)).toEqual(expected);
    });
  }
});
