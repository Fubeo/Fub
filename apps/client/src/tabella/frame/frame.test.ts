// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvedLanguage, t } from "../../i18n/strings";
import type { TableCaps, TableClipboard, TableEdit, TableMenuEntry } from "../adapter";
import { caseApplies, expectedOf, playCase, seenOf, TABLE_CONFORMANCE, type ConformanceClipboard, type ConformanceTarget } from "../conformance";
import { sortOrder } from "../sort";
import { fillRange } from "../selection";
import { todayText } from "../series";
import { columnName, forgetToldNotices, TableFrame, type TableFrameHost } from "./frame";
import { framePointer } from "./test-support";

const frames: TableFrame[] = [];

afterEach(() => {
  forgetToldNotices();
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
  const notices: string[] = [];
  const reads = { count: 0 };
  let frame: TableFrame | null = null;
  const host: TableFrameHost = {
    size: () => ({ rows: rows.length, columns: rows[0]?.length ?? 0 }),
    caps: () => caps,
    cellText: (row, column) => {
      reads.count += 1;
      return rows[row]?.[column] ?? "";
    },
    notice: (text) => void notices.push(text),
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
  return { frame, grid, cell, rows, edits, menus, copied, left, notices, reads };
}

/// Ciò che si è scritto nel campo della cella: il valore nuovo col cursore
/// in fondo, e l'evento `input` che il browser manderebbe.
function type(input: HTMLInputElement, value: string, inputType: string, isComposing = false): void {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new InputEvent("input", { inputType, isComposing, bubbles: true }));
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

  it("la maniglia tenuta col dito non copre la cella sotto: la selezione la segue", () => {
    const { frame, cell } = mount(ROWS);
    frame.focus({ row: 1, column: 0 });
    const handle = frame.element.querySelector<HTMLElement>('.tb-handle[data-end="end"]')!;
    // Sotto il dito c'è prima la maniglia stessa, poi la cella.
    const target = cell(2, 1);
    const fromPoint = vi.spyOn(document, "elementFromPoint").mockReturnValue(handle);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [handle, target] });
    try {
      handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, bubbles: true, cancelable: true }));
      handle.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }));
      expect(frame.selection.focus).toEqual({ row: 2, column: 1 });
      expect(frame.selection.anchor).toEqual({ row: 1, column: 0 });
    } finally {
      fromPoint.mockRestore();
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it("il completamento legge la colonna una volta, all'apertura, e la prima volta dice come si usa", () => {
    const { frame, rows, reads, notices } = mount([["Città"], ["Roma"], ["Milano"], [""], [""]]);
    frame.focus({ row: 3, column: 0 });
    key("M");
    const input = document.activeElement as HTMLInputElement;
    expect(input.value).toBe("Milano");
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 6]);
    // Si continua a scrivere: «i» al posto del resto scelto, e la proposta
    // torna senza rileggere la tabella.
    const opened = reads.count;
    type(input, "Mi", "insertText");
    expect(input.value).toBe("Milano");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(reads.count).toBe(opened);
    key("Enter");
    expect(rows[3]).toEqual(["Milano"]);
    // Il secondo completamento non lo ridice.
    key("R");
    key("Enter");
    expect(rows[4]).toEqual(["Roma"]);
    expect(notices).toEqual([t("table.completion.told")]);
  });

  it("continuare a scrivere ignora la proposta, Canc la toglie", () => {
    const { frame, rows } = mount([["Città"], ["Milano"], [""], [""]]);
    frame.focus({ row: 2, column: 0 });
    key("M");
    const input = document.activeElement as HTMLInputElement;
    type(input, "Mx", "insertText");
    expect(input.value).toBe("Mx");
    key("Enter");
    expect(rows[2]).toEqual(["Mx"]);
    // Adesso «M» comincia due valori, «Milano» e «Mx»: niente proposta finché
    // non ce n'è uno solo.
    key("M");
    const again = document.activeElement as HTMLInputElement;
    expect(again.value).toBe("M");
    type(again, "Mi", "insertText");
    expect(again.value).toBe("Milano");
    // Canc cancella il resto scelto: cancellare non ripropone.
    type(again, "Mi", "deleteContentForward");
    expect(again.value).toBe("Mi");
    key("Enter");
    expect(rows[3]).toEqual(["Mi"]);
  });

  it("con l'IME il completamento aspetta la fine della composizione", async () => {
    const { frame } = mount([["Città"], ["東京"], [""]]);
    frame.focus({ row: 2, column: 0 });
    key("F2");
    const input = document.activeElement as HTMLInputElement;
    type(input, "東", "insertCompositionText", true);
    expect(input.value).toBe("東");
    input.dispatchEvent(new CompositionEvent("compositionend", { data: "東", bubbles: true }));
    expect(input.value).toBe("東");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.value).toBe("東京");
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 2]);
  });

  it("Alt+= scrive la somma come valore e lo dice una volta; senza numeri sopra lo dice", () => {
    const { frame, rows, notices, edits } = mount([["Voce", "Importo"], ["a", "2"], ["b", "3"], ["c", ""], ["d", ""]]);
    frame.focus({ row: 3, column: 1 });
    key("=", { altKey: true, code: "Equal" });
    expect(rows[3]![1]).toBe("5");
    expect(edits).toHaveLength(1);
    frame.focus({ row: 4, column: 1 });
    key("=", { altKey: true, code: "Equal" });
    expect(rows[4]![1]).toBe("10");
    frame.focus({ row: 1, column: 0 });
    key("=", { altKey: true, code: "Equal" });
    expect(rows[1]![0]).toBe("a");
    expect(notices).toEqual([t("table.sum.value"), t("table.sum.none")]);
  });

  it("chi scrive «=» vede una volta che nella tabella resta testo", () => {
    const { frame, rows, notices } = mount([["Voce"], [""], [""]]);
    frame.focus({ row: 1, column: 0 });
    key("=");
    key("Enter");
    key("=");
    key("Enter");
    expect(rows.slice(1)).toEqual([["="], ["="]]);
    expect(notices).toEqual([t("table.formula.text")]);
  });

  it("l'avviso della formula tace su «==» e su un «=» che non sta in testa", () => {
    const { frame, rows, notices } = mount([["Voce"], [""], [""], [""], [""]]);
    const write = (row: number, value: string) => {
      frame.focus({ row, column: 0 });
      key("F2");
      type(document.activeElement as HTMLInputElement, value, "insertText");
      key("Enter");
    };
    write(1, "==");
    write(2, "a = b");
    write(3, " =x");
    expect(rows.slice(1, 4)).toEqual([["=="], ["a = b"], [" =x"]]);
    expect(notices).toEqual([]);
    write(4, "=A1+1");
    expect(notices).toEqual([t("table.formula.text")]);
  });

  it("la proposta accettata prende le maiuscole della colonna; chi scrive oltre tiene le sue", () => {
    const { frame, rows } = mount([["Città"], ["Milano"], [""], [""]]);
    frame.focus({ row: 2, column: 0 });
    key("m");
    expect((document.activeElement as HTMLInputElement).value).toBe("milano");
    key("Enter");
    expect(rows[2]).toEqual(["Milano"]);
    frame.focus({ row: 3, column: 0 });
    key("m");
    type(document.activeElement as HTMLInputElement, "mx", "insertText");
    key("Enter");
    expect(rows[3]).toEqual(["mx"]);
  });

  it("il resto proposto entra come una scrittura del campo, e solo lui ha il colore dell'accento", () => {
    const { frame } = mount([["Città"], ["Milano"], [""]]);
    // Il browser scrive con `insertText` e manda l'evento `input`: così
    // l'annulla del campo conosce il resto, e Ctrl+Z torna a «M». happy-dom
    // non ha `execCommand`: qui lo fa la prova come il browser, e il banco
    // prova l'annulla vero.
    const calls: unknown[][] = [];
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (command: string, ui: boolean, text: string) => {
        calls.push([command, ui, text]);
        const input = document.activeElement as HTMLInputElement;
        input.setRangeText(text, input.selectionStart!, input.selectionEnd!, "end");
        input.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
        return true;
      },
    });
    try {
      frame.focus({ row: 2, column: 0 });
      key("M");
      const input = document.activeElement as HTMLInputElement;
      expect(calls).toEqual([["insertText", false, "ilano"]]);
      expect(input.value).toBe("Milano");
      expect([input.selectionStart, input.selectionEnd]).toEqual([1, 6]);
      expect(input.classList.contains("is-proposal")).toBe(true);
      // Maiusc da solo non scrive: il colore resta. Una freccia lo toglie.
      key("Shift");
      expect(input.classList.contains("is-proposal")).toBe(true);
      key("ArrowRight");
      expect(input.classList.contains("is-proposal")).toBe(false);
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
    }
  });

  it("Ctrl+; nella cella aperta scrive la data dove sta il cursore", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15, 12));
    try {
      const { frame, rows } = mount([["Data"], ["dal "]]);
      frame.focus({ row: 1, column: 0 });
      key("F2");
      key(";", { ctrlKey: true });
      key("Enter");
      expect(rows[1]![0]).toBe(`dal ${todayText(new Date(), resolvedLanguage())}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("trascinando un'intestazione scelta un segno mostra dove andrà, e sparisce al rilascio", () => {
    const { frame, grid, edits } = mount([["Nome", "Voto", "Nota"], ["Ada", "10", "bene"]]);
    const letter = (index: number) => grid.querySelector<HTMLElement>(`.tb-letter[data-col="${index}"]`)!;
    const mark = frame.element.querySelector<HTMLElement>(".tb-drop")!;
    letter(0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(frame.range).toEqual({ r0: 0, c0: 0, r1: 1, c1: 0 });
    letter(0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    letter(2).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(mark.hidden).toBe(false);
    expect(mark.dataset.axis).toBe("column");
    expect(grid.classList.contains("is-moving-lines")).toBe(true);
    letter(2).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(mark.hidden).toBe(true);
    expect(grid.classList.contains("is-moving-lines")).toBe(false);
    expect(edits).toEqual([{ kind: "move-columns", from: 0, to: 0, by: 2 }]);
    expect(frame.range).toEqual({ r0: 0, c0: 2, r1: 1, c1: 2 });
  });

  it("un clic senza trascinare su più colonne scelte sceglie soltanto quella", () => {
    const { frame, grid, edits } = mount([["Nome", "Voto", "Nota"], ["Ada", "10", "bene"]]);
    const letter = (index: number) => grid.querySelector<HTMLElement>(`.tb-letter[data-col="${index}"]`)!;
    letter(0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    letter(1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
    expect(frame.range).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    letter(1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    letter(1).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(frame.range).toEqual({ r0: 0, c0: 1, r1: 1, c1: 1 });
    expect(edits).toEqual([]);
  });

  it("nella sola lettura le intestazioni scelgono ma non si spostano, e la somma non si scrive", () => {
    const { frame, grid, edits } = mount([["Nome", "Voto"], ["Ada", "1"], ["Bea", ""]], { readOnly: true });
    const letter = grid.querySelector<HTMLElement>('.tb-letter[data-col="0"]')!;
    letter.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    letter.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    grid.querySelector<HTMLElement>('.tb-letter[data-col="1"]')!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    frame.focus({ row: 2, column: 1 });
    key("=", { altKey: true, code: "Equal" });
    expect(edits).toEqual([]);
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
  afterEach(() => {
    vi.useRealTimers();
  });
  for (const test of TABLE_CONFORMANCE) {
    it.runIf(caseApplies(test, target))(test.name, async () => {
      if (test.today) {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(test.today));
      }
      const { frame, rows, edits } = mount(test.rows.map((row) => [...row]));
      frame.focus("first");
      const seen = await playCase(test, {
        key: (name, init) => key(name, init),
        command: (id) => void frame.runCommand(id),
        pointer: (gesture) => framePointer(frame.element, gesture),
        edits: () => edits.length,
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
