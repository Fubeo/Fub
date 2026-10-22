// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import {
  GRID_BYTES_PROTOCOL_VERSION,
  type GridApplyRequest,
  type GridBytesCell,
  type GridBytesSession,
  type GridBytesWindow,
  type GridCellKey,
  type GridCommit,
  type GridSurfaceSpec,
  type GridWindowRequest,
  type PluginError,
} from "../../host/contract";
import { resolvedLanguage, t } from "../../i18n/strings";
import { gridJournalText, parseGridJournal, recordGridJournal } from "../../state/grid-journal";
import { GridEngine, type GridChange, type GridHost } from "./engine";
import { decimalSeparator, localInput } from "./workbook";
import xlsx from "../../__fixtures__/xlsx-grid.json";

const SURFACE: GridSurfaceSpec = {
  id: "fub.grid.test",
  format: "xlsx",
  family: "grid",
  protocol_version: GRID_BYTES_PROTOCOL_VERSION,
};

const PLAIN = { bold: false, italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null };

interface Plan {
  readonly rows?: number;
  readonly columns?: number;
  readonly hiddenRows?: readonly number[];
  readonly hiddenColumns?: readonly number[];
  /** Gli input sul disco, per `"riga,colonna"`. */
  readonly cells?: Readonly<Record<string, string>>;
  readonly surfaces?: readonly GridSurfaceSpec[];
  /** Celle che il provider dice cambiate oltre a quelle scritte. */
  readonly invalidated?: readonly GridCellKey[];
  readonly onClose?: (instance: string) => void;
}

/**
 * Un provider della versione 2 per un foglio sintetico `main`: legge le
 * finestre che gli chiedono dal disco più il giornale, e controlla ogni
 * scrittura sulla revisione. È il banco delle proprietà della griglia che non
 * dipendono da una cartella vera.
 */
function bytesHost(plan: Plan = {}) {
  const rowCount = plan.rows ?? 100;
  const columnCount = plan.columns ?? 50;
  const disk = new Map(Object.entries(plan.cells ?? { "0,0": "1" }));
  const calls: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const active = new Set<string>();
  const requests: { row_start: number; column_start: number }[] = [];
  const applied: GridApplyRequest[] = [];
  let journal = "";
  let revision = 0;
  const rev = () => `rev-${revision}`;
  const at = (row: string, column: string) => disk.get(`${row.slice(1)},${column.slice(1)}`) ?? "";
  const inputs = () => {
    const current = new Map(disk);
    for (const entry of parseGridJournal(journal).entries) current.set(`${entry.row.slice(1)},${entry.column.slice(1)}`, entry.after);
    return current;
  };
  const host: GridHost = {
    listGridSurfaces: async () => {
      calls.push("list");
      return plan.surfaces ?? [SURFACE];
    },
    openGridBytes: async (surface, _doc, text) => {
      calls.push(`open ${surface}`);
      journal = text;
      const instance = `bytes-${opened.length + 1}`;
      opened.push(instance);
      active.add(instance);
      return {
        instance,
        revision: rev(),
        sheets: [{ id: "main", name: "Main", row_count: rowCount, column_count: columnCount }],
        active: "main",
        hidden: [],
        notices: [],
        conflicts: [],
        commands: [],
      };
    },
    gridBytesWindow: async (_surface, instance, request) => {
      calls.push("window");
      requests.push({ row_start: request.row_start, column_start: request.column_start });
      if (!active.has(instance)) throw new Error("closed");
      const current = inputs();
      const cells: GridBytesCell[] = [];
      for (let row = request.row_start; row < request.row_start + request.row_count; row += 1) {
        for (let column = request.column_start; column < request.column_start + request.column_count; column += 1) {
          const input = current.get(`${row},${column}`);
          if (input === undefined || input === "") continue;
          const number = Number(input);
          cells.push({
            key: { sheet: "main", row: `r${row}`, column: `c${column}` },
            input,
            style: PLAIN,
            value: Number.isFinite(number) ? { kind: "number", value: number } : { kind: "text", value: input },
            display: input,
            lock: null,
            stale: false,
            conflict: false,
          });
        }
      }
      return {
        revision: request.revision,
        sheet: request.sheet,
        row_start: request.row_start,
        column_start: request.column_start,
        total_rows: rowCount,
        total_columns: columnCount,
        rows: Array.from({ length: request.row_count }, (_, offset) => {
          const index = request.row_start + offset;
          return { id: `r${index}`, index, height: null, hidden: plan.hiddenRows?.includes(index) ?? false };
        }),
        columns: Array.from({ length: request.column_count }, (_, offset) => {
          const index = request.column_start + offset;
          return { id: `c${index}`, index, width: null, hidden: plan.hiddenColumns?.includes(index) ?? false };
        }),
        cells,
      };
    },
    applyGridBytes: async (_surface, _instance, request) => {
      calls.push("apply");
      applied.push(structuredClone(request));
      if (request.revision !== rev()) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      let next = parseGridJournal(journal);
      for (const patch of request.patches) next = recordGridJournal(next, patch.cell, at(patch.cell.row, patch.cell.column), patch.after);
      const deleted = journal;
      journal = gridJournalText(next);
      revision += 1;
      return {
        revision: rev(),
        edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
        invalidation: { kind: "cells", cells: [...request.patches.map((patch) => patch.cell), ...(plan.invalidated ?? [])] },
      };
    },
    gridBytesCommands: async () => [],
    gridBytesCommand: async (_surface, _instance, request) => {
      throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
    },
    closeGridBytes: async (_surface, instance) => {
      calls.push("close");
      closed.push(instance);
      active.delete(instance);
      plan.onClose?.(instance);
    },
  };
  return { host, calls, opened, closed, active, requests, applied, journal: () => journal };
}

type BytesHost = ReturnType<typeof bytesHost>;

async function mounted(grid: BytesHost | GridHost = bytesHost(), journal = "") {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const engine = new GridEngine(host, {
    surfaceId: "test",
    formatId: "xlsx",
    revision: "sha256:file",
    documentId: "test.xlsx",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    grid: "host" in grid ? grid.host : grid,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(journal);
  await settle();
  return { engine, host, viewport, changes };
}

/** Gli `after` del giornale, per `"riga,colonna"`. */
function written(journal: string): Record<string, string> {
  return Object.fromEntries(parseGridJournal(journal).entries
    .map((entry) => [`${entry.row.slice(1)},${entry.column.slice(1)}`, entry.after]));
}

afterEach(() => {
  document.body.replaceChildren();
});

/** Lascia finire ogni promessa in volo: un giro di macrotask viene dopo tutte. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Conferma la cella attiva come se l'utente ci avesse scritto `text` e Invio. */
function typeInActiveCell(host: HTMLElement, viewport: HTMLElement, text: string): void {
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: text, bubbles: true }));
  host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
}

const cellAt = (host: HTMLElement, row: number, column: number) =>
  host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", async () => {
    const { engine, host, viewport } = await mounted();
    expect(viewport.getAttribute("role")).toBe("grid");
    expect(viewport.getAttribute("aria-rowcount")).toBe("101");
    expect(viewport.getAttribute("aria-colcount")).toBe("51");
    expect(engine.renderedCellCount()).toBeLessThan(200);
    expect(host.querySelectorAll(".grid-cell").length).toBe(engine.renderedCellCount());

    viewport.scrollTop = 1_400;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    const renderedRows = [...host.querySelectorAll<HTMLElement>(".grid-cell")]
      .map((cell) => Number(cell.dataset.row));
    expect(Math.min(...renderedRows)).toBeGreaterThan(40);
    expect(engine.renderedCellCount()).toBeLessThan(200);
    engine.destroy();
  });

  it("annida ogni intestazione e cella alla propria riga semantica", async () => {
    const { engine, viewport } = await mounted();
    const rows = [...viewport.querySelectorAll<HTMLElement>('[role="row"]')];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.parentElement === viewport)).toBe(true);
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");

    for (const row of rows) {
      const rowIndex = row.getAttribute("aria-rowindex");
      expect(rowIndex).not.toBeNull();
      for (const child of [...row.children]) {
        const role = child.getAttribute("role");
        expect(["columnheader", "rowheader", "gridcell", "presentation"]).toContain(role);
        if (role === "columnheader") {
          expect(child.getAttribute("aria-rowindex")).toBe("1");
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        } else if (role === "rowheader") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(child.getAttribute("aria-colindex")).toBe("1");
        } else if (role === "gridcell") {
          expect(child.getAttribute("aria-rowindex")).toBe(rowIndex);
          expect(Number(child.getAttribute("aria-colindex"))).toBeGreaterThan(1);
        }
      }
    }
    expect([...viewport.querySelectorAll<HTMLElement>('[role="gridcell"]')]
      .every((cell) => cell.parentElement?.getAttribute("role") === "row")).toBe(true);
    engine.destroy();
  });

  it("tiene le battute locali e consegna al provider una sola modifica al commit", async () => {
    const grid = bytesHost();
    const { engine, host, viewport, changes } = await mounted(grid);
    const windows = grid.calls.filter((call) => call === "window").length;

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    await settle();
    expect(grid.applied).toHaveLength(0);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // Il giornale arriva alla sessione all'invio, prima della risposta.
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "X" });
    await settle();
    expect(grid.applied).toEqual([{
      revision: "rev-0",
      patches: [{ cell: { sheet: "main", row: "r0", column: "c0" }, before: "1", after: "X" }],
    }]);
    // La conferma rilegge la cella cambiata, e il provider tiene lo stesso giornale.
    expect(grid.calls.filter((call) => call === "window").length).toBeGreaterThan(windows);
    expect(changes).toHaveLength(1);
    expect(grid.journal()).toBe(engine.getDoc());
    expect(cellAt(host, 0, 0)?.textContent).toBe("X");
    engine.destroy();
  });

  it("incolla TSV come una sola modifica, e l'undo locale non tocca quella di un altro riquadro", async () => {
    const grid = bytesHost();
    const { engine, viewport, changes } = await mounted(grid);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "A\tB\nC\tD", setData: vi.fn() } });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "A", "0,1": "B", "1,0": "C", "1,1": "D" });
    await settle();
    expect(grid.applied).toHaveLength(1);
    expect(grid.applied[0].patches).toHaveLength(4);

    // Un altro riquadro scrive C3: la griglia si riapre sul suo giornale.
    const peer = recordGridJournal(parseGridJournal(engine.getDoc()), { sheet: "main", row: "r2", column: "c2" }, "", "peer");
    engine.syncDoc(gridJournalText(peer));
    await settle();
    expect(changes).toHaveLength(1);

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(changes).toHaveLength(2);
    expect(changes[1].origin).toBe("undo");
    expect(written(engine.getDoc())).toEqual({ "2,2": "peer" });
    await settle();
    expect(written(grid.journal())).toEqual({ "2,2": "peer" });
    engine.destroy();
  });

  it("le battute dell'editor della cella restano sue, e non la riaprono", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "9", bubbles: true, cancelable: true }));
    const content = host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!;
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    // CodeMirror scrive un carattere dall'input, e la battuta sale libera.
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true, cancelable: true }));
    expect(editor.state.selection.main.head).toBe(1);
    editor.dispatch({ changes: { from: 1, insert: "0" } });
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    // Un clic dentro l'editor sposta il cursore, e la cella resta aperta;
    // copiare dall'editor copia il suo testo, non la selezione della griglia.
    content.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    const copied: string[] = [];
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", {
      value: { setData: (_type: string, text: string) => copied.push(text), clearData: () => {} },
    });
    content.dispatchEvent(copy);
    expect(editor.state.doc.toString()).toBe("90");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
    expect(copied).toEqual(["90"]);
    engine.destroy();
  });

  it("rilegge la cella invalidata sulle coordinate globali senza degradare gli ID sconosciuti", async () => {
    const grid = bytesHost({
      rows: 512,
      columns: 256,
      cells: { "0,0": "1", "300,200": "old" },
      invalidated: [{ sheet: "main", row: "missing-row", column: "missing-column" }],
    });
    const { engine, host, viewport } = await mounted(grid);
    viewport.scrollTop = 300 * 28;
    viewport.scrollLeft = 200 * 120;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(cellAt(host, 300, 200)?.textContent).toBe("old");

    cellAt(host, 300, 200)!.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    const before = grid.requests.length;
    const formula = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!);
    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "new" }, userEvent: "input" });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(grid.requests.slice(before)).toEqual([{ row_start: 256, column_start: 128 }]);
    expect(cellAt(host, 300, 200)?.textContent).toBe("new");
    expect(written(engine.getDoc())).toEqual({ "300,200": "new" });
    engine.destroy();
  });

  it("estende la selezione da tastiera e ripristina il fuoco dopo Escape", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(viewport);
    engine.destroy();
  });

  it("la formula bar conserva la bozza e gestisce commit, cancel e blur", async () => {
    const { engine, host, viewport, changes } = await mounted();
    const formula = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!);

    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "7" }, userEvent: "input" });
    expect(changes).toHaveLength(0);
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(changes).toHaveLength(1);
    expect(written(engine.getDoc())).toEqual({ "0,0": "7" });
    await settle();

    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "8" }, userEvent: "input" });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(changes).toHaveLength(1);
    await settle();
    expect(written(engine.getDoc())).toEqual({ "0,0": "7" });

    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "9" }, userEvent: "input" });
    viewport.focus();
    await settle();
    expect(changes).toHaveLength(2);
    expect(written(engine.getDoc())).toEqual({ "0,0": "9" });
    engine.destroy();
  });

  it("copia e incolla una cella multilinea al suo posto senza toccare le vicine", async () => {
    const multiline = "prima\nseconda\tterza";
    const grid = bytesHost({ rows: 2, columns: 2, cells: { "0,0": multiline, "0,1": "B1", "1,0": "A2", "1,1": "B2" } });
    const { engine, viewport, changes } = await mounted(grid);
    let copied = "";
    const clipboard = {
      getData: () => copied,
      setData: (_type: string, text: string) => { copied = text; },
    };
    for (const type of ["copy", "paste"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      viewport.dispatchEvent(event);
    }
    await settle();
    expect(changes).toHaveLength(0);
    expect(grid.applied).toEqual([]);
    expect(copied).toBe('"prima\nseconda\tterza"\n');
    expect(engine.selectedText()).toEqual({ primary: multiline, secondary: [] });
    engine.destroy();
  });

  it("dice l'intervallo scelto come testo da leggere, fino a un tetto", async () => {
    const { engine, viewport } = await mounted();
    expect(engine.selectedText()).toEqual({ primary: "1", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selectedText()).toEqual({ primary: "1\t\n\t", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    // Cento righe per cinquanta colonne: sotto il tetto di diecimila celle.
    expect(engine.selectedText()?.primary.split("\n")).toHaveLength(100);
    engine.destroy();
    expect(engine.selectedText()).toBeNull();

    const large = await mounted(bytesHost({ rows: 200, columns: 60 }));
    large.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(large.engine.selectedText()).toBeNull();
    large.engine.destroy();
  });

  it("barra delle formule ed editor di cella sono campi, non documenti", async () => {
    const { engine, host } = await mounted();
    for (const selector of [".grid-formula-editor", ".grid-cell-editor"]) {
      const field = host.querySelector<HTMLElement>(selector)!;
      expect(field.querySelector(".cm-lineNumbers")).toBeNull();
      expect(findTextEditorOrThrow(field).contentDOM.getAttribute("spellcheck")).toBe("false");
    }
    engine.destroy();
  });

  it("annulla la bozza locale quando un altro riquadro riapre la cartella", async () => {
    const { engine, host, viewport, changes } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    const peer = gridJournalText(recordGridJournal(parseGridJournal(""), { sheet: "main", row: "r0", column: "c0" }, "1", "peer"));

    engine.syncDoc(peer);
    await settle();

    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(engine.getDoc()).toBe(peer);
    expect(cellAt(host, 0, 0)?.textContent).toBe("peer");
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("salta gli assi nascosti e avvolge Tab sulla riga visibile successiva", async () => {
    const { engine, viewport } = await mounted(bytesHost({ rows: 3, columns: 3, hiddenRows: [0], hiddenColumns: [1] }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    engine.destroy();
  });

  it("lascia uscire Tab ai bordi senza intrappolare il fuoco", async () => {
    const { engine, viewport } = await mounted(bytesHost({ rows: 1, columns: 2 }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    viewport.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(false);
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(engine.selection().focus).toEqual({ row: 0, column: 1 });
    const exit = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    viewport.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(false);
    expect(engine.selection().focus).toEqual({ row: 0, column: 1 });
    engine.destroy();
  });

  it("non espone un discendente attivo quando ogni asse è nascosto", async () => {
    const grid = bytesHost({ rows: 1, columns: 1, hiddenRows: [0], hiddenColumns: [0] });
    const { engine, host, viewport, changes } = await mounted(grid);
    expect(viewport.hasAttribute("aria-activedescendant")).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });

  it("sceglie deterministicamente la prima superficie compatibile dichiarata", async () => {
    const grid = bytesHost({
      surfaces: [
        { ...SURFACE, id: "other-format", format: "ods" },
        { ...SURFACE, id: "first" },
        { ...SURFACE, id: "second" },
      ],
    });
    const { engine } = await mounted(grid);
    expect(grid.calls.filter((call) => call.startsWith("open"))).toEqual(["open first"]);
    engine.destroy();
  });

  it("rifiuta famiglia o versione sconosciuta prima di aprire una sessione", async () => {
    const grid = bytesHost({
      surfaces: [
        { ...SURFACE, id: "wrong-family", family: "other" },
        { ...SURFACE, id: "wrong-version", protocol_version: GRID_BYTES_PROTOCOL_VERSION + 1 },
      ],
    });
    const { engine, host } = await mounted(grid);
    expect(grid.opened).toEqual([]);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    engine.destroy();
  });

  it("chiude prima del teardown e riapre con un'istanza nuova senza residui", async () => {
    let mountedAtClose = false;
    const grid = bytesHost({ onClose: () => { mountedAtClose = document.querySelector(".grid-surface") !== null; } });
    const first = await mounted(grid);
    first.engine.destroy();
    expect(grid.opened).toEqual(["bytes-1"]);
    expect(grid.closed).toEqual(["bytes-1"]);
    expect(grid.active.size).toBe(0);
    expect(mountedAtClose).toBe(true);
    expect(first.host.querySelector(".grid-surface")).toBeNull();

    const second = await mounted(grid);
    expect(grid.opened).toEqual(["bytes-1", "bytes-2"]);
    expect(grid.active).toEqual(new Set(["bytes-2"]));
    const callsAfterSecondOpen = grid.calls.length;
    first.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await settle();
    expect(grid.calls.length).toBe(callsAfterSecondOpen);

    second.engine.destroy();
    expect(grid.closed).toEqual(["bytes-1", "bytes-2"]);
    expect(grid.active.size).toBe(0);
    expect(second.host.querySelector(".grid-surface")).toBeNull();
    const callsAfterDestroy = grid.calls.length;
    second.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await settle();
    expect(grid.calls.length).toBe(callsAfterDestroy);
  });

  it("legge solo il viewport anche con assi da centomila righe", async () => {
    const grid = bytesHost({ rows: 100_000, columns: 1_000, cells: {} });
    const { engine, viewport } = await mounted(grid);
    const initialWindows = grid.calls.filter((call) => call === "window").length;
    expect(initialWindows).toBeLessThanOrEqual(4);
    viewport.scrollTop = 90_000 * 28;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(grid.calls.filter((call) => call === "window").length).toBeLessThanOrEqual(initialWindows + 4);
    engine.destroy();
  });

  it("chiude la sessione se il provider cade nella prima finestra", async () => {
    const grid = bytesHost();
    Object.assign(grid.host, { gridBytesWindow: async () => { throw new Error("provider trap"); } });
    const { engine, host } = await mounted(grid);
    expect(grid.opened).toHaveLength(1);
    expect(grid.closed).toEqual(grid.opened);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).toContain("provider trap");
    engine.destroy();
  });

  it("consegna il giornale alla sessione all'invio, anche se la linguetta si chiude prima della risposta", async () => {
    const grid = bytesHost();
    const answers: Array<() => void> = [];
    const apply = grid.host.applyGridBytes;
    Object.assign(grid.host, {
      applyGridBytes: async (...args: Parameters<GridHost["applyGridBytes"]>) => {
        await new Promise<void>((resolve) => answers.push(resolve));
        return apply(...args);
      },
    });
    const { engine, host, viewport, changes } = await mounted(grid);
    typeInActiveCell(host, viewport, "X");
    // Prima di ogni risposta: la sessione ha già il giornale, e diventa sporca.
    expect(changes).toHaveLength(1);
    expect(written(changes[0].text)).toEqual({ "0,0": "X" });
    await settle();
    expect(answers).toHaveLength(1);
    engine.destroy();
    answers.forEach((answer) => answer());
    await settle();
    // Dopo il teardown niente: il riquadro può già mostrare un altro documento.
    expect(changes).toHaveLength(1);
  });
});

function workbookHost(options: { readonly base?: () => string } = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const applied: GridApplyRequest[] = [];
  const answers: Array<() => void> = [];
  let hold = false;
  let failApply: PluginError | null = null;
  let journal = "";
  let instances = 0;
  const base = options.base ?? (() => xlsx.document_revision);
  const sessionFor = (text: string): GridBytesSession => {
    if (text === xlsx.conflict.journal) return structuredClone(xlsx.conflict.session) as GridBytesSession;
    const session = structuredClone(xlsx.session) as GridBytesSession;
    return { ...session, revision: text === "" ? session.revision : `rev:${text}` };
  };
  const diskOf = (sheet: string, row: string, column: string) => (xlsx.windows as GridBytesWindow[])
    .find((window) => window.sheet === sheet)?.cells
    .find((cell) => cell.key.row === row && cell.key.column === column)?.input ?? "";
  const revisionOf = (text: string) => text === xlsx.edit.commit.edit.inserted
    ? xlsx.edit.commit.revision
    : text === "" ? xlsx.session.revision : `rev:${text}`;
  const host: GridHost = {
    listGridSurfaces: async () => {
      calls.push("list");
      return [xlsx.surface];
    },
    openGridBytes: async (surface, doc, text, revision) => {
      calls.push(`open ${surface} ${doc} ${text === "" ? "∅" : "journal"} ${revision === xlsx.document_revision ? "base" : revision}`);
      if (revision !== base()) throw { kind: "conflict", message: "grid source changed" } satisfies PluginError;
      journal = text;
      const session = sessionFor(text);
      session.instance = `xlsx-${++instances}`;
      opened.push(session.instance);
      return session;
    },
    gridBytesWindow: async (_surface, instance, request: GridWindowRequest) => {
      calls.push(`window ${request.sheet} ${request.row_start} ${request.column_start}`);
      if (closed.includes(instance)) throw new Error("closed");
      if (request.revision === xlsx.edit.commit.revision && request.sheet === "s1") {
        return structuredClone(xlsx.edit.window) as GridBytesWindow;
      }
      if (journal === xlsx.conflict.journal && request.sheet === "s1") {
        return structuredClone(xlsx.conflict.window) as GridBytesWindow;
      }
      const window = structuredClone((xlsx.windows as GridBytesWindow[]).find((candidate) => candidate.sheet === request.sheet)!);
      window.revision = request.revision;
      for (const entry of parseGridJournal(journal).entries.filter((candidate) => candidate.sheet === request.sheet)) {
        const cell = window.cells.find((candidate) => candidate.key.row === entry.row && candidate.key.column === entry.column);
        if (cell) Object.assign(cell, { input: entry.after, display: entry.after });
      }
      return window;
    },
    applyGridBytes: async (_surface, _instance, request) => {
      calls.push("apply");
      applied.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (failApply) throw failApply;
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      let next = parseGridJournal(journal);
      for (const patch of request.patches) {
        next = recordGridJournal(next, patch.cell, diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column), patch.after);
      }
      const deleted = journal;
      journal = gridJournalText(next);
      const commit: GridCommit = {
        revision: revisionOf(journal),
        edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
        invalidation: { kind: "cells", cells: request.patches.map((patch) => patch.cell) },
      };
      return commit;
    },
    gridBytesCommands: async () => [],
    gridBytesCommand: async (_surface, _instance, request) => {
      throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
    },
    closeGridBytes: async (_surface, instance) => {
      calls.push("close");
      closed.push(instance);
    },
  };
  return {
    host,
    calls,
    opened,
    closed,
    applied,
    journal: () => journal,
    hold: (value: boolean) => { hold = value; },
    release: () => { for (const answer of answers.splice(0)) answer(); },
    failApply: (error: PluginError | null) => { failApply = error; },
  };
}

describe("GridEngine con una cartella di Excel", () => {
  async function workbookMounted(
    grid: ReturnType<typeof workbookHost> | null = workbookHost(),
    journal = "",
    base?: () => string,
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: GridChange[] = [];
    let selections = 0;
    const engine = new GridEngine(host, {
      surfaceId: "xlsx",
      formatId: "xlsx",
      revision: xlsx.document_revision,
      documentId: "conti.xlsx",
      base,
      onChange: (change) => changes.push(change),
      onSelectionChange: () => { selections += 1; },
      grid: grid?.host,
    });
    const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 400 },
    });
    engine.setDoc(journal);
    await settle();
    const cell = (row: number, column: number) =>
      host.querySelector<HTMLElement>(`.grid-cell[data-row="${row}"][data-column="${column}"]`);
    const notice = () => host.querySelector<HTMLElement>(".grid-notice")!;
    const formula = () => findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-formula-editor")!).state.doc.toString();
    const go = (row: number, column: number) => {
      cell(row, column)!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    };
    return { engine, host, viewport, changes, cell, notice, formula, go, selections: () => selections };
  }

  const decimal = () => decimalSeparator(resolvedLanguage());

  it("apre la versione 2 sui byte del documento e mostra i valori del file", async () => {
    const grid = workbookHost();
    const { engine, host, cell, notice, formula, go } = await workbookMounted(grid);
    expect(grid.calls.slice(0, 3)).toEqual(["list", "open fub.grid.xlsx conti.xlsx ∅ base", "window s1 0 0"]);
    const surface = host.querySelector<HTMLElement>(".grid-surface")!;
    expect(surface.dataset.gridProfile).toBe("workbook");
    expect(surface.dataset.gridProtocol).toBe("v2");
    expect(surface.dataset.readOnly).not.toBe("true");
    expect(cell(0, 0)?.textContent).toBe("Voce");
    expect(cell(0, 0)?.style.fontWeight).toBe("700");
    expect(cell(0, 0)?.style.textAlign).toBe("center");
    expect(cell(1, 2)?.textContent).toBe("50.00%");
    expect(cell(3, 2)?.textContent).toBe("#DIV/0!");
    expect(cell(3, 1)?.style.backgroundColor).not.toBe("");
    // La colonna D e la riga 6 sono nascoste nel file.
    expect(cell(0, 3)).toBeNull();
    expect(cell(5, 5)).toBeNull();
    // L'area versata dalla matrice ha i valori del file, e non si scrive.
    expect(cell(4, 5)?.textContent).toBe("2");
    expect(cell(4, 5)?.getAttribute("aria-readonly")).toBe("true");
    expect(cell(1, 1)?.hasAttribute("aria-readonly")).toBe(false);
    expect(notice().hidden).toBe(false);
    expect(notice().getAttribute("role")).toBe("status");
    expect(notice().textContent).not.toBe("");
    // La barra mostra l'input da scrivere, nella lingua; la cella il valore.
    go(1, 2);
    expect(formula()).toBe(localInput("0.5", decimal()));
    go(2, 2);
    expect(formula()).toBe("=B3/B4");
    expect(engine.selectedText()).toEqual({ primary: "-15.00%", secondary: [] });
    engine.destroy();
    await settle();
    expect(grid.closed).toEqual(grid.opened);
  });

  it("scrive una cella nel giornale, lo pubblica subito e lo fa controllare al provider", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, notice, go } = await workbookMounted(grid);
    go(1, 1);
    typeInActiveCell(host, viewport, "9");
    // `typeInActiveCell` scrive una battuta: la cella diventa `9`, poi `900`
    // con una seconda modifica. Il giornale va alla sessione all'invio.
    expect(changes).toHaveLength(1);
    expect(changes[0].origin).toBe("input");
    expect(engine.getDoc()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    expect(cell(1, 1)?.textContent).toBe("9");
    await settle();
    expect(grid.applied[0]).toEqual({
      revision: xlsx.session.revision,
      patches: [{ cell: { sheet: "s1", row: "r1", column: "c1" }, before: "800", after: "9" }],
    });

    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "900" } });
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    // La seconda modifica tiene il `before` dei byte: è la fixture del provider.
    expect(engine.getDoc()).toBe(xlsx.edit.commit.edit.inserted);
    expect(grid.applied[1]).toEqual({ ...xlsx.edit.request, revision: grid.applied[1].revision, patches: [{ ...xlsx.edit.request.patches[0], before: "9" }] });
    // Le formule che leggono B2 mostrano il valore del file, segnato.
    expect(cell(3, 1)?.classList.contains("stale")).toBe(true);
    expect(cell(3, 1)?.textContent).toBe("680");
    expect(notice().textContent).toContain(" ");

    // Annullare riporta i byte: il giornale si svuota.
    expect(engine.undo()).toBe(true);
    expect(changes[changes.length - 1]?.origin).toBe("undo");
    expect(engine.getDoc()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("");
    await settle();
    expect(grid.journal()).toBe("");
    expect(cell(1, 1)?.textContent).toBe("800");
    expect(engine.redo()).toBe(true);
    await settle();
    expect(grid.journal()).toBe(gridJournalText({ entries: [{ sheet: "s1", row: "r1", column: "c1", before: "800", after: "9" }], commands: [] }));
    engine.destroy();
  });

  it("scrive i numeri col separatore della lingua, e il provider li tiene col punto", async () => {
    const grid = workbookHost();
    const { engine, viewport, changes, go } = await workbookMounted(grid);
    go(1, 1);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    const typed = decimal() === "," ? "1,5\tx" : "1.5\tx";
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => typed } });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    await settle();
    expect(grid.applied[0].patches.map((patch) => patch.after)).toEqual(["1.5", "x"]);
    engine.destroy();
  });

  it("non scrive le celle bloccate né le formule, e dice perché", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, notice, go, formula } = await workbookMounted(grid);
    go(4, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    const locked = notice().textContent;
    expect(locked).not.toBe("");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(formula()).toBe("");

    go(1, 0);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true }));
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(notice().textContent).not.toBe(locked);
    expect(changes).toEqual([]);

    // La selezione che prende una cella bloccata non si svuota.
    go(3, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(changes).toEqual([]);

    engine.setReadOnly(true);
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    await settle();
    expect(grid.applied).toEqual([]);
    engine.destroy();
  });

  it("una modifica che il provider rifiuta esce dal giornale, e lo dice", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, notice, go } = await workbookMounted(grid);
    grid.failApply({ kind: "bad_args", message: "grid cell text is too long" });
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    expect(engine.getDoc()).not.toBe("");
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(changes[changes.length - 1]?.text).toBe("");
    expect(notice().textContent).toContain("grid cell text is too long");
    expect(cell(1, 1)?.textContent).toBe("800");
    expect(engine.undo()).toBe(false);
    engine.destroy();
  });

  it("una cella che il provider dice bloccata lo dice come un blocco", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, notice, go } = await workbookMounted(grid);
    grid.failApply({ kind: "permission_denied", message: "grid cell is locked (merged)" });
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    await settle();
    expect(engine.getDoc()).toBe("");
    expect(notice().textContent).toContain(t("grid.workbook.locked", { reason: t("grid.workbook.lock.other") }));
    engine.destroy();
  });

  it("le modifiche in coda partono una dopo l'altra, e l'ultima conferma corregge il giornale", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, go } = await workbookMounted(grid);
    grid.hold(true);
    go(1, 1);
    typeInActiveCell(host, viewport, "1");
    go(2, 1);
    typeInActiveCell(host, viewport, "2");
    await settle();
    expect(grid.applied).toHaveLength(1);
    grid.release();
    await settle();
    expect(grid.applied).toHaveLength(2);
    grid.release();
    await settle();
    // Il provider tiene lo stesso giornale: niente da ripubblicare.
    expect(changes).toHaveLength(2);
    expect(grid.journal()).toBe(engine.getDoc());
    expect(parseGridJournal(engine.getDoc()).entries.map((entry) => entry.after)).toEqual(["1", "2"]);
    engine.destroy();
  });

  it("si riapre sui byte nuovi dopo un salvataggio, e chiude la sessione di prima", async () => {
    let base = xlsx.document_revision;
    const grid = workbookHost({ base: () => base });
    const { engine, host, viewport, cell, go } = await workbookMounted(grid, "", () => base);
    go(1, 1);
    typeInActiveCell(host, viewport, "5");
    await settle();
    // La sessione ha salvato: il giornale torna vuoto sui byte nuovi.
    base = "sha256:salvata";
    engine.syncDoc("");
    await settle();
    expect(grid.calls.filter((call) => call.startsWith("open"))).toEqual([
      "open fub.grid.xlsx conti.xlsx ∅ base",
      "open fub.grid.xlsx conti.xlsx ∅ sha256:salvata",
    ]);
    expect(grid.closed).toEqual([grid.opened[0]]);
    expect(engine.getDoc()).toBe("");
    // Lo stesso testo sugli stessi byte non riapre niente.
    engine.syncDoc("");
    await settle();
    expect(grid.opened).toHaveLength(2);
    expect(cell(0, 0)?.textContent).toBe("Voce");
    engine.destroy();
  });

  it("un file cambiato sotto non si apre, e la griglia non scrive", async () => {
    const grid = workbookHost({ base: () => "sha256:altra" });
    const { engine, host, viewport, changes, notice } = await workbookMounted(grid);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(notice().hidden).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toEqual([]);
    engine.destroy();
  });

  it("senza il componente della cartella lo dice", async () => {
    const { engine, host, notice } = await workbookMounted(null);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("unavailable");
    expect(notice().hidden).toBe(false);
    engine.destroy();
  });

  it("segna le celle che il file ha cambiato sotto il giornale", async () => {
    const grid = workbookHost();
    const { engine, cell, notice } = await workbookMounted(grid, xlsx.conflict.journal);
    expect(cell(1, 1)?.classList.contains("conflict")).toBe(true);
    expect(cell(1, 1)?.getAttribute("aria-invalid")).toBe("true");
    expect(cell(1, 1)?.textContent).toBe("900");
    expect(notice().textContent).not.toBe("");
    engine.destroy();
  });

  it("passa da un foglio all'altro con le schede, e le toglie al teardown", async () => {
    const grid = workbookHost();
    const { engine, host, cell, selections } = await workbookMounted(grid);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>(".grid-sheets [role=tab]")];
    // Il foglio nascosto non ha una scheda.
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Conti", "Note"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    tabs[1].click();
    await settle();
    expect(grid.calls).toContain("window s2 0 0");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(cell(0, 0)?.textContent).toBe("Una nota");
    expect(selections()).toBe(1);
    engine.destroy();
    expect(host.querySelector(".grid-sheets")).toBeNull();
  });
});
