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
  type GridCellStyle,
  type GridCommand,
  type GridCommandOutcome,
  type GridCommandRequest,
  type GridCommandState,
  type GridCommit,
  type GridDialog,
  type GridSurfaceSpec,
  type GridWindowRequest,
  type PluginError,
} from "../../host/contract";
import { resolvedLanguage, t } from "../../i18n/strings";
import { HOVER_OPEN_DELAY_MS } from "../../kit";
import { gridJournalText, parseGridJournal, recordGridJournal, type GridJournal } from "../../state/grid-journal";
import { fillTarget, GridEngine, typingOpens, type GridChange, type GridEngineOptions, type GridHost } from "./engine";
import { cellA1, parseCellA1 } from "./merges";
import { DEFAULT_SHEET_VIEW, decimalSeparator, localInput } from "./workbook";
import xlsx from "../../__fixtures__/xlsx-grid.json";

const SURFACE: GridSurfaceSpec = {
  id: "fub.grid.test",
  format: "xlsx",
  family: "grid",
  protocol_version: GRID_BYTES_PROTOCOL_VERSION,
};

const PLAIN: GridCellStyle = {
  bold: false,
  italic: false,
  text_color: null,
  fill_color: null,
  horizontal: null,
  number_format: null,
  font: null,
  font_size: null,
  underline: null,
  strike: false,
  script: null,
  vertical: null,
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  borders: { top: null, right: null, bottom: null, left: null, diagonal_down: null, diagonal_up: null },
};

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
        book: structuredClone(xlsx.session.book) as GridBytesSession["book"],
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
            style: 0,
            value: Number.isFinite(number) ? { kind: "number", value: number } : { kind: "text", value: input },
            display: input,
            lock: null,
            stale: false,
            conflict: false,
            data_bar: null,
            icon: null,
            comment: null,
            link: null,
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
        styles: [PLAIN],
        merges: [],
        view: { ...DEFAULT_SHEET_VIEW },
        tables: [],
        objects: [],
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
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: text[0], bubbles: true }));
  if (text.length > 1) {
    const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: text.slice(1) }, userEvent: "input" });
  }
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
    // Aperta da una battuta la cella è in «Inserisci»; F2 passa a «Modifica»,
    // dove le frecce muovono il cursore e non la confermano.
    expect(engine.editMode()).toBe("insert");
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }));
    expect(engine.editMode()).toBe("edit");
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

    // Invio ha confermato e la cella attiva è scesa: la barra scrive in A2.
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    formula.focus();
    formula.dispatch({ changes: { from: 0, to: formula.state.doc.length, insert: "9" }, userEvent: "input" });
    viewport.focus();
    await settle();
    expect(changes).toHaveLength(2);
    expect(written(engine.getDoc())).toEqual({ "0,0": "7", "1,0": "9" });
    engine.destroy();
  });

  it("copia e incolla una cella multilinea al suo posto senza toccare le vicine", async () => {
    const multiline = "prima\nseconda\tterza";
    const grid = bytesHost({ rows: 2, columns: 2, cells: { "0,0": multiline, "0,1": "B1", "1,0": "A2", "1,1": "B2" } });
    const { engine, viewport, changes } = await mounted(grid);
    const copied = new Map<string, string>();
    const clipboard = {
      getData: (type: string) => copied.get(type) ?? "",
      setData: (type: string, text: string) => { copied.set(type, text); },
    };
    for (const type of ["copy", "paste"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      viewport.dispatchEvent(event);
    }
    await settle();
    expect(changes).toHaveLength(0);
    expect(grid.applied).toEqual([]);
    expect(copied.get("text/plain")).toBe('"prima\nseconda\tterza"\n');
    // La tabella HTML di Fub non vince sul TSV: incollata, porta gli input.
    expect(copied.get("text/html")).toContain("data-fub-table");
    expect(copied.get("text/html")).toContain("prima<br>seconda\tterza");
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

  it("tiene la bozza quando un altro riquadro riapre la cartella, e chiede se la sua cella è cambiata", async () => {
    const { engine, host, viewport, changes } = await mounted();
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    const notice = host.querySelector<HTMLElement>(".grid-draft-notice")!;
    const draft = () => findTextEditorOrThrow(editorHost).state.doc.toString();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));

    // Un'altra cella cambia: la bozza resta com'è, senza domande.
    const other = gridJournalText(recordGridJournal(parseGridJournal(""), { sheet: "main", row: "r0", column: "c1" }, "", "altro"));
    engine.syncDoc(other);
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(notice.hidden).toBe(true);
    expect(cellAt(host, 0, 1)?.textContent).toBe("altro");

    // La sua cella cambia: la bozza resta e si chiede quale tenere.
    const peer = gridJournalText(recordGridJournal(parseGridJournal(other), { sheet: "main", row: "r0", column: "c0" }, "1", "peer"));
    engine.syncDoc(peer);
    await settle();
    expect(editorHost.hidden).toBe(false);
    expect(draft()).toBe("X");
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("peer");
    [...notice.querySelectorAll("button")].find((button) => button.textContent === t("grid.draft.take"))!.click();
    expect(editorHost.hidden).toBe(true);
    expect(notice.hidden).toBe(true);
    expect(cellAt(host, 0, 0)?.textContent).toBe("peer");
    expect(changes).toHaveLength(0);

    // «Tieni la tua»: la bozza resta, e Invio la scrive sopra quella nuova.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Y", bubbles: true }));
    const again = gridJournalText(recordGridJournal(parseGridJournal(peer), { sheet: "main", row: "r0", column: "c0" }, "1", "peer2"));
    engine.syncDoc(again);
    await settle();
    expect(notice.hidden).toBe(false);
    [...notice.querySelectorAll("button")].find((button) => button.textContent === t("grid.draft.keep"))!.click();
    expect(notice.hidden).toBe(true);
    expect(draft()).toBe("Y");
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())["0,0"]).toBe("Y");
    engine.destroy();
  });

  it("Invio conferma e scende, Tab va di lato e Invio torna alla colonna di partenza", async () => {
    const { engine, host, viewport } = await mounted();
    const press = (key: string, init: KeyboardEventInit = {}) => host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    const type = (key: string) => viewport.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    type("7");
    press("Enter");
    type("5");
    press("Enter");
    expect(written(engine.getDoc())).toEqual({ "0,0": "7", "1,0": "5" });
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });

    type("a");
    press("Tab");
    type("b");
    press("Tab");
    type("c");
    press("Enter");
    expect(written(engine.getDoc())).toMatchObject({ "2,0": "a", "2,1": "b", "2,2": "c" });
    expect(engine.selection().focus).toEqual({ row: 3, column: 0 });

    // In «Inserisci» una freccia conferma e si sposta; Maiusc+Invio sale.
    type("d");
    press("ArrowRight");
    expect(written(engine.getDoc())["3,0"]).toBe("d");
    expect(engine.selection().focus).toEqual({ row: 3, column: 1 });
    type("e");
    press("Enter", { shiftKey: true });
    expect(written(engine.getDoc())["3,1"]).toBe("e");
    expect(engine.selection().focus).toEqual({ row: 2, column: 1 });
    expect(engine.editMode()).toBe("ready");
    engine.destroy();
  });

  it("Invio sulla selezione sposta senza aprire, e dentro l'intervallo gira", async () => {
    const { engine, host, viewport } = await mounted();
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("Enter");
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    key("Enter", { shiftKey: true });
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });

    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const chosen = { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } };
    key("Enter");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 1, column: 0 } });
    key("Enter");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 0, column: 1 } });
    key("Tab");
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 1, column: 0 } });
    key("Tab", { shiftKey: true });
    expect(engine.selection()).toEqual({ ...chosen, active: { row: 0, column: 1 } });

    // Una battuta scrive nella cella attiva, e Ctrl+Invio in tutta la selezione.
    key("z");
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "0,0": "z", "0,1": "z", "1,0": "z", "1,1": "z" });
    engine.destroy();
  });

  it("le frecce senza Maiusc partono dalla cella attiva, non dall'altro capo", async () => {
    const { engine, viewport } = await mounted();
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } });
    key("ArrowRight");
    expect(engine.selection()).toEqual({ anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } });
    engine.destroy();
  });

  it("PagGiù conta le righe vere, Alt+PagGiù va di lato, Ctrl+Backspace torna alla cella attiva", async () => {
    const { engine, viewport } = await mounted(bytesHost({ hiddenRows: [3, 4, 5] }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // 272 px sotto le intestazioni: nove righe e mezza che si vedono, più le
    // tre nascoste che non contano.
    key("PageDown");
    expect(engine.selection().focus).toEqual({ row: 12, column: 0 });
    expect(viewport.scrollTop).toBe(252);
    key("PageUp");
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    expect(viewport.scrollTop).toBe(0);
    key("PageDown", { altKey: true });
    expect(engine.selection().focus.row).toBe(0);
    expect(engine.selection().focus.column).toBeGreaterThan(1);

    key("PageUp", { altKey: true });
    key("PageDown");
    viewport.scrollTop = 0;
    key("Backspace", { ctrlKey: true });
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(written(engine.getDoc())).toEqual({});
    engine.destroy();
  });

  it("incolla dall'angolo, e un valore riempie tutta la selezione", async () => {
    const { engine, viewport } = await mounted();
    const paste = (data: Record<string, string>) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data[type] ?? "" } });
      viewport.dispatchEvent(event);
    };
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // B2:C3 scelta dal basso: si incolla comunque da B2.
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowUp", { shiftKey: true });
    key("ArrowLeft", { shiftKey: true });
    paste({ "text/plain": "x\n" });
    expect(written(engine.getDoc())).toEqual({ "1,1": "x", "1,2": "x", "2,1": "x", "2,2": "x" });
    expect(engine.selection()).toEqual({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });

    // La tabella HTML di un altro programma vince sul testo, con le celle unite.
    key("Home", { ctrlKey: true });
    paste({
      "text/plain": "sbagliato\n",
      "text/html": "<table><tr><td colspan=2>uno<br>due</td><td>3</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>",
    });
    expect(written(engine.getDoc())).toMatchObject({ "0,0": "uno\ndue", "0,2": "3", "1,0": "a", "1,1": "b", "1,2": "c" });
    engine.destroy();
  });

  it("taglia segna con le formiche, e l'incolla sposta in un passo", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ cells: { "0,0": "1", "0,1": "2" } }));
    const copied = new Map<string, string>();
    const clipboard = {
      getData: (type: string) => copied.get(type) ?? "",
      setData: (type: string, text: string) => { copied.set(type, text); },
    };
    const send = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      viewport.dispatchEvent(event);
    };
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("ArrowRight", { shiftKey: true });
    send("cut");
    expect(written(engine.getDoc())).toEqual({});
    expect(host.querySelector(".grid-cut-mark")).not.toBeNull();
    key("Escape");
    expect(host.querySelector(".grid-cut-mark")).toBeNull();

    send("cut");
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    send("paste");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "0,1": "", "2,1": "1", "2,2": "2" });
    expect(host.querySelector(".grid-cut-mark")).toBeNull();
    engine.undo();
    expect(written(engine.getDoc())).toEqual({});
    engine.destroy();
  });

  it("una battuta vera lascia scrivere il browser, una sintetica porta il suo carattere", () => {
    const event = (init: Partial<KeyboardEvent>) =>
      ({ key: "", isTrusted: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, getModifierState: () => false, ...init }) as KeyboardEvent;
    expect(typingOpens(event({ key: "a", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "Dead", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "Process", isTrusted: true }))).toBe("browser");
    expect(typingOpens(event({ key: "a" }))).toBe("seed");
    expect(typingOpens(event({ key: "Dead" }))).toBeNull();
    expect(typingOpens(event({ key: "a", ctrlKey: true, isTrusted: true }))).toBeNull();
    expect(typingOpens(event({ key: "a", altKey: true, isTrusted: true }))).toBeNull();
    // AltGr scrive (@, €, [): su Windows arriva come Ctrl+Alt.
    expect(typingOpens(event({ key: "@", ctrlKey: true, altKey: true, isTrusted: true, getModifierState: (key: string) => key === "AltGraph" }))).toBe("browser");
    expect(typingOpens(event({ key: "Enter", isTrusted: true }))).toBeNull();
  });

  it("un clic su un'altra cella conferma quella aperta, e la cella toccata resta la stessa", async () => {
    const { engine, host, viewport } = await mounted();
    const target = cellAt(host, 2, 1)!;
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(cellAt(host, 2, 1)).toBe(target);
    expect(engine.selection().focus).toEqual({ row: 2, column: 1 });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "5", bubbles: true }));
    const other = cellAt(host, 0, 0)!;
    other.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(written(engine.getDoc())).toEqual({ "2,1": "5" });
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(cellAt(host, 0, 0)).toBe(other);
    expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
    engine.destroy();
  });

  it("il fuoco che lascia la cella aperta la conferma, e lo scorrimento non la chiude", async () => {
    const { engine, host, viewport } = await mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    const editorHost = host.querySelector<HTMLElement>(".grid-cell-editor")!;
    viewport.scrollTop = 28;
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(editorHost.hidden).toBe(false);
    expect(editorHost.parentElement).toBe(cellAt(host, 0, 0));

    viewport.focus();
    await settle();
    expect(editorHost.hidden).toBe(true);
    expect(written(engine.getDoc())).toEqual({ "0,0": "q" });
    engine.destroy();
  });

  it("disegna l'intervallo con un rettangolo solo, e segna le intestazioni dopo i nascosti", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 4, columns: 4, hiddenRows: [1], hiddenColumns: [1] }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    // Una cella sola: il bordo è quello della cella attiva.
    expect(host.querySelector(".grid-selection")).toBeNull();
    expect(viewport.classList.contains("ranged")).toBe(false);
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    expect(host.querySelectorAll(".grid-selection")).toHaveLength(1);
    expect(viewport.classList.contains("ranged")).toBe(true);
    expect(host.querySelector(".grid-cell.active")?.classList.contains("selected")).toBe(true);
    key("Escape");
    key("ArrowLeft");
    expect(host.querySelector(".grid-selection")).toBeNull();
    expect(viewport.classList.contains("ranged")).toBe(false);
    // La tacca dei nascosti sta sull'intestazione che li segue.
    const marked = [...host.querySelectorAll(".grid-header.after-hidden")].map((header) => header.textContent);
    expect(marked.sort()).toEqual(["3", "C"]);
    engine.destroy();
  });

  it("Maiusc+F8 aggiunge alla selezione, Canc svuota tutti gli intervalli, e copia li rifiuta", async () => {
    const { engine, host, viewport } = await mounted(bytesHost({ rows: 6, columns: 6, cells: { "0,0": "a", "2,2": "c", "1,1": "b" } }));
    const key = (name: string, init: KeyboardEventInit = {}) =>
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    key("F8", { shiftKey: true });
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowRight");
    key("ArrowRight");
    key("Escape");
    // A1 resta scelta, e C3 è l'intervallo in cui si lavora; B2 no.
    expect(host.querySelectorAll(".grid-selection")).toHaveLength(2);
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    const data = new Map<string, string>();
    Object.defineProperty(copy, "clipboardData", { value: { setData: (type: string, text: string) => data.set(type, text), getData: () => "" } });
    viewport.dispatchEvent(copy);
    expect(data.size).toBe(0);
    key("Delete");
    expect(written(engine.getDoc())).toEqual({ "0,0": "", "2,2": "" });
    // Fuori dal modo, una freccia ricomincia da un intervallo solo.
    key("ArrowLeft");
    expect(host.querySelector(".grid-selection")).toBeNull();
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

/// Il valore che un comando d'input scrive, come input della cella.
function inputOfValue(value: unknown): string {
  return value === null ? "" : typeof value === "string" ? value : String(value);
}

/// Le celle che i comandi `range.setValues` del giornale scrivono, per foglio.
function commandInputs(journal: GridJournal): Map<string, string> {
  const out = new Map<string, string>();
  for (const command of journal.commands) {
    if (command.id !== "range.setValues") continue;
    const { range, values } = JSON.parse(command.params) as { range: string; values: unknown[][] };
    const at = parseCellA1(range)!;
    out.set(`${command.sheet}\u0000r${at.row}\u0000c${at.column}`, inputOfValue(values[0]![0]));
  }
  return out;
}

function workbookHost(options: {
  readonly base?: () => string;
  /// Se la sessione serve `range.setValues`: con `false` il catalogo non
  /// riceve formule.
  readonly serves?: boolean;
  /// Cambia la finestra prima che arrivi alla griglia.
  readonly window?: (window: GridBytesWindow) => void;
  /// La finestra di dialogo che un comando chiede.
  readonly dialog?: (command: GridCommand) => GridDialog | null;
  /// I comandi che il catalogo non serve.
  readonly drop?: readonly string[];
} = {}) {
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
  const given: GridCommandRequest[] = [];
  const undone: GridCommand[] = [];
  const catalog = (): GridCommandState[] => (structuredClone(xlsx.session.commands) as GridCommandState[])
    .filter((command) => options.serves !== false || command.id !== "range.setValues")
    .filter((command) => !options.drop?.includes(command.id));
  const sessionFor = (text: string): GridBytesSession => {
    if (text === xlsx.conflict.journal) return structuredClone(xlsx.conflict.session) as GridBytesSession;
    const session = structuredClone(xlsx.session) as GridBytesSession;
    return { ...session, revision: text === "" ? session.revision : `rev:${text}`, commands: catalog() };
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
      const parsed = parseGridJournal(journal);
      const written = [
        ...parsed.entries.map((entry) => [entry.sheet, entry.row, entry.column, entry.after] as const),
        ...[...commandInputs(parsed)].map(([key, input]) => [...key.split("\u0000"), input] as [string, string, string, string]),
      ];
      for (const [sheet, row, column, input] of written.filter((candidate) => candidate[0] === request.sheet)) {
        const cell = window.cells.find((candidate) => candidate.key.row === row && candidate.key.column === column);
        const value = input === "" ? { kind: "blank" as const } : { kind: "text" as const, value: input };
        if (cell) Object.assign(cell, { input, display: input, value });
        else window.cells.push({ ...structuredClone(window.cells[0]!), key: { sheet, row, column }, input, display: input, value, style: 0 });
      }
      options.window?.(window);
      return window;
    },
    applyGridBytes: async (_surface, _instance, request) => {
      calls.push("apply");
      applied.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (failApply) throw failApply;
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      let next = parseGridJournal(journal);
      // Come il provider: una formula nuova, o un giornale già a comandi,
      // porta ogni cella dentro come `range.setValues`.
      const commanding = next.commands.length > 0 || request.patches.some((patch) =>
        patch.after.startsWith("=") && patch.after !== diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column));
      if (commanding) {
        const input = (sheet: string, row: string, column: string, value: string): GridCommand => {
          const at = cellA1({ row: Number(row.slice(1)), column: Number(column.slice(1)) });
          return { id: "range.setValues", params: JSON.stringify({ range: at, values: [[value === "" ? null : value]] }), sheet, selection: at, active: at };
        };
        let commands = next.commands.length ? [...next.commands] : next.entries.map((entry) => input(entry.sheet, entry.row, entry.column, entry.after));
        for (const patch of request.patches) commands = [...commands, input(patch.cell.sheet, patch.cell.row, patch.cell.column, patch.after)];
        next = { entries: [], commands };
        undone.length = 0;
      } else {
        for (const patch of request.patches) {
          next = recordGridJournal(next, patch.cell, diskOf(patch.cell.sheet, patch.cell.row, patch.cell.column), patch.after);
        }
      }
      const deleted = journal;
      journal = gridJournalText(next);
      const commit: GridCommit = {
        revision: revisionOf(journal),
        edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
        invalidation: commanding ? { kind: "all" } : { kind: "cells", cells: request.patches.map((patch) => patch.cell) },
      };
      return commit;
    },
    gridBytesCommands: async () => {
      calls.push("commands");
      return catalog();
    },
    gridBytesCommand: async (_surface, _instance, request) => {
      calls.push(`command ${request.command.id}`);
      given.push(structuredClone(request));
      if (hold) await new Promise<void>((resolve) => answers.push(resolve));
      if (request.revision !== revisionOf(journal)) throw { kind: "conflict", message: "stale grid revision" } satisfies PluginError;
      if (!catalog().some((command) => command.id === request.command.id)) {
        throw { kind: "bad_args", message: `grid command \`${request.command.id}\` is not served` } satisfies PluginError;
      }
      const current = parseGridJournal(journal);
      let commands = [...current.commands];
      if (request.command.id === "edit.undo") {
        const last = commands.pop();
        if (!last) throw { kind: "bad_args", message: "nothing to undo" } satisfies PluginError;
        undone.push(last);
      } else if (request.command.id === "edit.redo") {
        const again = undone.pop();
        if (!again) throw { kind: "bad_args", message: "nothing to redo" } satisfies PluginError;
        commands.push(again);
      } else {
        commands = [
          ...current.entries.map((entry) => {
            const at = cellA1({ row: Number(entry.row.slice(1)), column: Number(entry.column.slice(1)) });
            return { id: "range.setValues", params: JSON.stringify({ range: at, values: [[entry.after]] }), sheet: entry.sheet, selection: at, active: at };
          }),
          ...commands,
          request.command,
        ];
        undone.length = 0;
      }
      const deleted = journal;
      journal = gridJournalText({ entries: [], commands });
      const outcome: GridCommandOutcome = {
        commit: {
          revision: revisionOf(journal),
          edit: { from: 0, to: new TextEncoder().encode(deleted).length, deleted, inserted: journal },
          invalidation: { kind: "all" },
        },
        sheets: structuredClone(xlsx.session.sheets),
        hidden: structuredClone(xlsx.session.hidden),
        selection: { sheet: request.command.sheet, selection: request.command.selection, active: request.command.active },
        result: null,
        dialog: options.dialog?.(request.command) ?? null,
        commands: catalog(),
        book: structuredClone(xlsx.session.book) as GridBytesSession["book"],
      };
      return outcome;
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
    given,
    journal: () => journal,
    hold: (value: boolean) => { hold = value; },
    release: () => { for (const answer of answers.splice(0)) answer(); },
    failApply: (error: PluginError | null) => { failApply = error; },
  };
}

describe("fillTarget", () => {
  const source = { rowStart: 1, rowEnd: 2, columnStart: 1, columnEnd: 1 };
  it("estende lungo l'asse su cui il puntatore è uscito di più", () => {
    expect(fillTarget(source, { row: 6, column: 3 })).toEqual({ ...source, rowEnd: 6 });
    expect(fillTarget(source, { row: 3, column: 5 })).toEqual({ ...source, columnEnd: 5 });
    expect(fillTarget(source, { row: 0, column: 1 })).toEqual({ ...source, rowStart: 0 });
    expect(fillTarget(source, { row: 2, column: 0 })).toEqual({ ...source, columnStart: 0 });
  });
  it("dentro la sorgente non riempie", () => {
    expect(fillTarget(source, { row: 2, column: 1 })).toBe(source);
  });
});

describe("GridEngine con una cartella di Excel", () => {
  async function workbookMounted(
    grid: ReturnType<typeof workbookHost> | null = workbookHost(),
    journal = "",
    base?: () => string,
    extra: Pick<GridEngineOptions, "onCommands" | "onDialog"> = {},
  ) {
    const host = document.createElement("div");
    document.body.append(host);
    const changes: GridChange[] = [];
    let selections = 0;
    const engine = new GridEngine(host, {
      ...extra,
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
    expect(cell(3, 1)?.style.getPropertyValue("--file-fill")).not.toBe("");
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

  it("non scrive le celle bloccate, e dice perché", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, notice, go, formula } = await workbookMounted(grid);
    go(4, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    const locked = notice().textContent;
    expect(locked).not.toBe("");
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(formula()).toBe("");

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

  it("una formula dove la sessione non serve i comandi non si scrive, e lo dice", async () => {
    const grid = workbookHost({ serves: false });
    const { engine, host, viewport, changes, notice, go } = await workbookMounted(grid);
    go(1, 0);
    typeInActiveCell(host, viewport, "=B2*2");
    expect(notice().textContent).toContain(t("grid.workbook.formula"));
    expect(changes).toEqual([]);
    await settle();
    expect(grid.applied).toEqual([]);
    engine.destroy();
  });

  it("la prima formula porta la sessione ai comandi: il giornale lo scrive il provider", async () => {
    const grid = workbookHost();
    const { engine, host, viewport, changes, cell, go } = await workbookMounted(grid);
    go(1, 1);
    typeInActiveCell(host, viewport, "7");
    await settle();
    expect(parseGridJournal(engine.getDoc()).entries).toHaveLength(1);
    go(2, 1);
    typeInActiveCell(host, viewport, "=B2*2");
    // La griglia la mostra subito, ma il giornale aspetta il provider.
    expect(cell(2, 1)?.textContent).toBe("=B2*2");
    expect(parseGridJournal(engine.getDoc()).entries).toHaveLength(1);
    await settle();
    const journal = parseGridJournal(engine.getDoc());
    expect(journal.entries).toEqual([]);
    expect(journal.commands.map((command) => [command.id, command.selection])).toEqual([
      ["range.setValues", "B2"],
      ["range.setValues", "B3"],
    ]);
    expect(changes[changes.length - 1]?.text).toBe(grid.journal());

    // Da qui annulla e ripeti sono del documento.
    expect(engine.undo()).toBe(true);
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["edit.undo"]);
    expect(parseGridJournal(engine.getDoc()).commands).toHaveLength(1);
    expect(engine.redo()).toBe(true);
    await settle();
    expect(parseGridJournal(engine.getDoc()).commands).toHaveLength(2);
    // Niente da ripetere non è un errore da dire.
    expect(engine.redo()).toBe(true);
    await settle();
    expect(host.querySelector<HTMLElement>(".grid-notice")!.textContent).not.toContain("nothing to redo");
    engine.destroy();
  });

  it("un comando del catalogo va al provider sulla selezione, e la griglia adotta l'esito", async () => {
    const grid = workbookHost({ dialog: (command) => command.id === "home.formatCells" ? { id: "formatCells", params: "{}" } : null });
    const dialogs: GridDialog[] = [];
    let catalogs = 0;
    const { engine, viewport, changes, go } = await workbookMounted(grid, "", undefined, {
      onCommands: () => { catalogs += 1; },
      onDialog: (dialog) => dialogs.push(dialog),
    });
    expect(engine.commands().some((command) => command.id === "home.bold")).toBe(true);
    const before = catalogs;
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    await settle();
    expect(catalogs).toBeGreaterThan(before);
    expect(engine.command("home.bold")).toBe(true);
    await settle();
    expect(grid.given[0]?.command).toMatchObject({ id: "home.bold", params: "{}", sheet: "s1", selection: "B2:B3", active: "B2" });
    expect(parseGridJournal(changes[changes.length - 1]!.text).commands.map((command) => command.id)).toEqual(["home.bold"]);
    expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 1 } });

    expect(engine.command("home.formatCells")).toBe(true);
    await settle();
    expect(dialogs).toEqual([{ id: "formatCells", params: "{}" }]);
    // Un comando che il catalogo non serve non parte.
    expect(engine.command("non.esiste")).toBe(false);
    engine.setReadOnly(true);
    expect(engine.command("home.bold")).toBe(false);
    engine.destroy();
  });

  it("le scorciatoie di Excel danno i comandi del catalogo", async () => {
    const grid = workbookHost();
    const { engine, viewport, go } = await workbookMounted(grid);
    go(1, 1);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "%", code: "Digit5", ctrlKey: true, shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "=", code: "Equal", altKey: true, bubbles: true }));
    // Ctrl+«-» su una cella sola chiede come, in Excel: qui non fa niente.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, bubbles: true }));
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["home.bold", "home.percent", "formulas.autoSum"]);
    engine.destroy();
  });

  it("disegna un'unione come una cella sola, e la selezione e il cursore la prendono tutta", async () => {
    const grid = workbookHost();
    const { engine, viewport, cell, go } = await workbookMounted(grid);
    const merged = cell(0, 6)!;
    expect(merged.classList.contains("merged")).toBe(true);
    expect(merged.getAttribute("aria-colspan")).toBe("2");
    expect(merged.getAttribute("aria-rowspan")).toBe("1");
    expect(cell(0, 7)).toBeNull();
    expect(merged.style.width).toBe(`${Number.parseFloat(cell(0, 5)!.style.width) * 2}px`);

    go(0, 6);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 8 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 0, column: 6 });
    go(1, 5);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    // L'intervallo F1:G2 tocca G1:H1, e la prende tutta.
    expect(cell(1, 7)!.classList.contains("selected")).toBe(true);
    expect(cell(0, 6)!.classList.contains("selected")).toBe(true);
    engine.destroy();
  });

  it("blocca i riquadri, nasconde griglia e intestazioni e ingrandisce come dice la vista del foglio", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        window.view = { ...DEFAULT_SHEET_VIEW, frozen_rows: 1, frozen_columns: 1, gridlines: false, headings: false, zoom: 150 };
      },
    });
    const { engine, host, viewport, cell } = await workbookMounted(grid);
    const canvas = host.querySelector<HTMLElement>(".grid-canvas")!;
    expect(canvas.style.fontSize).toBe("150.0%");
    expect(viewport.classList.contains("no-gridlines")).toBe(true);
    expect(host.querySelector(".grid-row-header")).toBeNull();
    expect(host.querySelector(".grid-column-header")).toBeNull();
    expect(host.querySelectorAll(".grid-freeze")).toHaveLength(2);
    expect(cell(1, 0)!.classList.contains("frozen")).toBe(true);
    expect(cell(1, 1)!.classList.contains("frozen")).toBe(false);
    // Lo zoom allarga le colonne nella stessa misura.
    expect(Number.parseFloat(cell(1, 1)!.style.width)).toBeGreaterThan(100);

    // Scorrendo, la prima riga e la prima colonna restano.
    viewport.scrollTop = 1500;
    viewport.scrollLeft = 1500;
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
    expect(cell(0, 0)).not.toBeNull();
    expect(cell(0, 1)).toBeNull();
    expect(cell(1, 0)).toBeNull();
    engine.destroy();
  });

  it("disegna lo stile, i bordi, le barre, le icone e i commenti delle celle", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const style = window.styles.length;
        window.styles = [...window.styles, {
          ...window.styles[1]!,
          font: "Cambria",
          font_size: 22,
          underline: "double",
          strike: true,
          vertical: "top",
          wrap: true,
          borders: {
            top: { style: "thick", color: "#112233" },
            right: null,
            bottom: { style: "dashed", color: null },
            left: null,
            diagonal_down: { style: "thin", color: "#445566" },
            diagonal_up: null,
          },
        }];
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        Object.assign(affitto, {
          style,
          comment: { author: "Ada", text: "Da rivedere", threaded: true, resolved: false, replies: [{ author: "Bea", text: "Fatto" }] },
        });
        const importo = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c1")!;
        Object.assign(importo, { data_bar: { fraction: 0.5, color: "#638EC6", gradient: false }, icon: { set: "3Arrows", index: 2 } });
        const spesa = window.cells.find((cell) => cell.key.row === "r2" && cell.key.column === "c1")!;
        spesa.link = { target: "https://example.org", tooltip: null, external: true };
      },
    });
    const { engine, host, cell } = await workbookMounted(grid);
    const affitto = cell(1, 0)!;
    expect(affitto.style.fontFamily).toContain("Cambria");
    expect(affitto.style.fontSize).toBe("2em");
    expect(affitto.style.alignContent).toBe("start");
    expect(affitto.style.whiteSpace).toBe("pre-wrap");
    const text = affitto.querySelector<HTMLElement>(".grid-cell-text")!;
    expect(text.style.textDecorationLine).toBe("underline line-through");
    expect(text.style.textDecorationStyle).toBe("double");
    expect(affitto.querySelector(".grid-comment-mark.threaded")).not.toBeNull();
    // Il thread non sta più nel `title`: lo dice la cella a chi non vede, e lo
    // mostra la scheda al passaggio.
    expect(affitto.title).toBe("");
    expect(affitto.dataset.comment).toBe("thread");
    expect(affitto.getAttribute("aria-description")).toBe("Commento: Ada: Da rivedere. Bea: Fatto");
    const border = [...host.querySelectorAll<HTMLElement>(".grid-border")]
      .find((element) => element.style.borderTop.includes("#112233") || element.style.borderTop.includes("rgb(17, 34, 51)"))!;
    expect(border).toBeDefined();
    expect(border.style.borderBottom).toContain("dashed");
    expect(border.style.backgroundImage).toContain("linear-gradient");

    const importo = cell(1, 1)!;
    const bar = importo.querySelector<HTMLElement>(".grid-data-bar")!;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.style.background.toLowerCase()).toMatch(/#638ec6|rgb\(99, 142, 198\)/u);
    expect(importo.querySelector<HTMLElement>(".grid-icon")!.textContent).toBe("⬆");
    // Un numero senza allineamento del file va a destra.
    expect(cell(2, 1)!.style.textAlign).toBe("end");
    expect(cell(2, 1)!.title).toBe("https://example.org");
    engine.destroy();
  });

  it("mostra il thread di un commento al passaggio, e i suoi gesti valgono per quella cella", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        affitto.comment = { author: "Ada", text: "Da rivedere", threaded: true, resolved: false, replies: [{ author: "Bea", text: "Fatto" }] };
        const nota = window.cells.find((cell) => cell.key.row === "r2" && cell.key.column === "c0")!;
        nota.comment = { author: "", text: "Promemoria", threaded: false, resolved: false, replies: [] };
      },
    });
    const opened: string[] = [];
    const { engine, cell, go } = await workbookMounted(grid, "", undefined, { onDialog: (dialog) => opened.push(dialog.id) });
    go(2, 1);
    const hover = async (target: HTMLElement) => {
      target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, HOVER_OPEN_DELAY_MS + 30));
      await settle();
      return document.body.querySelector<HTMLElement>(".grid-comment-card");
    };
    const card = (await hover(cell(1, 0)!))!;
    expect(card).not.toBeNull();
    expect(card.closest("[role=region]")?.getAttribute("aria-label")).toBe("Commento in A2");
    expect([...card.querySelectorAll(".grid-comment-post")].map((post) => post.textContent)).toEqual(["AdaDa rivedere", "BeaFatto"]);
    const field = card.querySelector<HTMLTextAreaElement>(".grid-comment-field")!;
    expect(document.body.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(t("grid.comment.reply_field"));
    field.value = "Ricontrollato";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    // La risposta va alla cella indicata, non alla cella attiva (B3).
    const reply = grid.given.find((request) => request.command.id === "review.replyComment")!;
    expect(JSON.parse(reply.command.params)).toEqual({ cell: "A2", text: "Ricontrollato" });
    expect(reply.command.active).toBe("B3");
    expect(document.body.querySelector(".grid-comment-card")).toBeNull();

    const resolve = (await hover(cell(1, 0)!))!;
    const labels = [...resolve.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].map((button) => button.textContent);
    expect(labels).toEqual([t("grid.comment.reply"), t("grid.comment.resolve"), t("grid.comment.edit"), t("grid.comment.delete")]);
    [...resolve.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].find((button) => button.textContent === t("grid.comment.resolve"))!.click();
    await settle();
    const resolved = grid.given.find((request) => request.command.id === "review.resolveComment")!;
    expect(JSON.parse(resolved.command.params)).toEqual({ cell: "A2", resolved: true });

    // La nota: niente risposta, e Modifica seleziona la cella e apre la sua finestra.
    const note = (await hover(cell(2, 0)!))!;
    expect(note.querySelector(".grid-comment-field")).toBeNull();
    expect(note.closest("[role=region]")?.getAttribute("aria-label")).toBe("Nota in A3");
    [...note.querySelectorAll<HTMLButtonElement>(".grid-comment-action")].find((button) => button.textContent === t("grid.comment.edit"))!.click();
    await settle();
    expect(opened).toEqual(["note"]);
    expect(engine.selectionRefs().active).toBe("A3");
    engine.destroy();
    expect(document.body.querySelector(".grid-comment-card")).toBeNull();
  });

  it("in sola lettura la scheda mostra soltanto il thread", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        const affitto = window.cells.find((cell) => cell.key.row === "r1" && cell.key.column === "c0")!;
        affitto.comment = { author: "Ada", text: "Da rivedere", threaded: true, resolved: true, replies: [] };
      },
    });
    const { engine, cell } = await workbookMounted(grid);
    engine.setReadOnly(true);
    await settle();
    expect(cell(1, 0)!.getAttribute("aria-description")).toBe("Commento risolto: Ada: Da rivedere");
    expect(cell(1, 0)!.querySelector(".grid-comment-mark.resolved")).not.toBeNull();
    cell(1, 0)!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, HOVER_OPEN_DELAY_MS + 30));
    await settle();
    const card = document.body.querySelector<HTMLElement>(".grid-comment-card")!;
    expect(card.querySelector(".grid-comment-resolved")?.textContent).toBe(t("grid.comment.resolved"));
    expect(card.querySelector(".grid-comment-field, .grid-comment-action")).toBeNull();
    engine.destroy();
  });

  it("un testo lungo passa nelle celle vuote accanto, fino alla prima piena", async () => {
    const grid = workbookHost({
      window: (window) => {
        if (window.sheet !== "s1") return;
        window.cells.push(
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r7", column: "c0" }, input: "Un testo lungo che non sta", display: "Un testo lungo che non sta", value: { kind: "text", value: "Un testo lungo che non sta" } },
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r7", column: "c3" }, input: "Fine", display: "Fine", value: { kind: "text", value: "Fine" } },
          { ...structuredClone(window.cells[4]!), key: { sheet: "s1", row: "r8", column: "c0" }, style: window.styles.length, input: "A capo", display: "A capo", value: { kind: "text", value: "A capo" } },
        );
        window.styles = [...window.styles, { ...window.styles[1]!, wrap: true }];
      },
    });
    const { engine, cell } = await workbookMounted(grid);
    const long = cell(7, 0)!;
    const width = Number.parseFloat(long.style.width);
    expect(long.classList.contains("spill")).toBe(true);
    const reach = Number.parseFloat(cell(1, 1)!.style.width) + Number.parseFloat(cell(1, 2)!.style.width);
    expect(long.querySelector<HTMLElement>(".grid-cell-text")!.style.maxWidth).toBe(`calc(${width + reach}px - 0.9rem)`);
    expect(cell(8, 0)!.classList.contains("spill")).toBe(false);
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
  /// Una griglia larga abbastanza da mostrare il disegno di «Conti», che sta
  /// dalla colonna J in poi.
  describe("i gesti del puntatore", () => {
    const press = (target: EventTarget, type: string, x: number, y: number, extra: PointerEventInit = {}) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, ...extra }));
    /// Il punto dentro un elemento: con la griglia a 0,0 dello schermo e niente
    /// scorrimento, le coordinate della tela sono quelle dello schermo. Una
    /// cella sta nella sua riga.
    const inside = (element: HTMLElement) => {
      const row = element.parentElement?.classList.contains("grid-row") ? parseFloat(element.parentElement.style.top) : 0;
      // Più in là dei 4 px dove il bordo di un'intestazione si tira.
      return { x: parseFloat(element.style.left) + 8, y: row + parseFloat(element.style.top) + 8 };
    };
    const at = (cell: (row: number, column: number) => HTMLElement | null, row: number, column: number) => inside(cell(row, column)!);
    const handle = (host: HTMLElement) => host.querySelector<HTMLElement>(".grid-fill-handle");

    it("trascinando si seleziona un intervallo, anche quando la cattura manda i movimenti alla griglia", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 3, 2);
      press(viewport, "pointermove", end.x, end.y);
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      press(viewport, "pointerup", end.x, end.y);
      // Dopo il rilascio il puntatore non trascina più.
      const later = at(cell, 4, 4);
      press(viewport, "pointermove", later.x, later.y, { buttons: 0 });
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      engine.destroy();
    });

    it("le intestazioni prendono la colonna o la riga intera, e l'angolo il foglio", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      // La cella attiva (il fuoco) resta sulla prima riga o colonna.
      const column = at(cell, 0, 2);
      press(viewport, "pointerdown", column.x, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 2 });
      expect(engine.selection().anchor.column).toBe(2);
      expect(engine.selection().anchor.row).toBeGreaterThan(3);
      const next = at(cell, 0, 4);
      press(viewport, "pointermove", next.x, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 4 });
      expect(engine.selection().anchor.column).toBe(2);
      press(viewport, "pointerup", next.x, 10);

      const row = at(cell, 2, 0);
      press(viewport, "pointerdown", 10, row.y);
      expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
      expect(engine.selection().anchor.row).toBe(2);
      expect(engine.selection().anchor.column).toBeGreaterThan(4);
      press(viewport, "pointerup", 10, row.y);

      press(viewport, "pointerdown", 10, 10);
      expect(engine.selection().focus).toEqual({ row: 0, column: 0 });
      expect(engine.selection().anchor.row).toBeGreaterThan(3);
      press(viewport, "pointerup", 10, 10);
      engine.destroy();
    });

    it("il tasto destro sceglie la cella fuori dalla selezione e lascia quella dentro, come Excel", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost());
      const pointing = vi.spyOn(document, "elementFromPoint");
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 3, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      // Dentro la selezione: resta com'è.
      const inner = at(cell, 2, 2);
      pointing.mockReturnValue(cell(2, 2));
      expect(engine.pointAt(inner.x, inner.y)).toBe("cell");
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 3, column: 2 } });
      // Fuori: la cella sola.
      const outer = at(cell, 4, 4);
      pointing.mockReturnValue(cell(4, 4));
      expect(engine.pointAt(outer.x, outer.y)).toBe("cell");
      expect(engine.selection()).toMatchObject({ anchor: { row: 4, column: 4 }, focus: { row: 4, column: 4 } });
      // L'intestazione di una riga: la riga intera.
      const row = at(cell, 2, 0);
      pointing.mockReturnValue(viewport);
      expect(engine.pointAt(10, row.y)).toBe("row");
      expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
      expect(engine.selection().anchor.row).toBe(2);
      // Fuori dalla griglia, niente.
      pointing.mockReturnValue(document.body);
      expect(engine.pointAt(1, 1)).toBeNull();
      pointing.mockRestore();
      engine.destroy();
    });

    it("il quadratino tirato riempie con `edit.autoFill`, e con Ctrl nel modo alternato", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      const grip = handle(host)!;
      expect(grip).not.toBeNull();
      expect(grip.getAttribute("aria-hidden")).toBe("true");
      const start = inside(grip);
      press(grip, "pointerdown", start.x, start.y);
      const end = at(cell, 4, 1);
      press(viewport, "pointermove", end.x, end.y);
      const preview = host.querySelector<HTMLElement>(".grid-fill-preview")!;
      expect(preview).not.toBeNull();
      expect(viewport.classList.contains("filling")).toBe(true);
      press(viewport, "pointerup", end.x, end.y);
      await settle();
      expect(grid.given.map((request) => request.command.id)).toEqual(["edit.autoFill"]);
      expect(JSON.parse(grid.given[0].command.params)).toEqual({ source: "B2", target: "B2:B5" });
      expect(viewport.classList.contains("filling")).toBe(false);
      // La cella attiva resta all'àncora, la sorgente.
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 4, column: 1 } });

      go(1, 2);
      await settle();
      const again = inside(handle(host)!);
      press(handle(host)!, "pointerdown", again.x, again.y);
      const side = at(cell, 1, 5);
      press(viewport, "pointermove", side.x, side.y);
      press(viewport, "pointerup", side.x, side.y, { ctrlKey: true });
      await settle();
      expect(JSON.parse(grid.given[1].command.params)).toEqual({ source: "C2", target: "C2:F2", mode: "alternate" });
      engine.destroy();
    });

    it("rilasciato dentro la sorgente, o annullato, il quadratino non riempie", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      const start = inside(handle(host)!);
      press(handle(host)!, "pointerdown", start.x, start.y);
      press(viewport, "pointerup", start.x, start.y);
      press(handle(host)!, "pointerdown", start.x, start.y);
      const end = at(cell, 4, 1);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointercancel", end.x, end.y);
      await settle();
      expect(grid.given).toEqual([]);
      expect(host.querySelector(".grid-fill-preview")).toBeNull();
      engine.destroy();
    });

    it("il doppio clic sul quadratino riempie in giù fin dove arriva la colonna accanto", async () => {
      const grid = workbookHost();
      const { engine, host, go } = await workbookMounted(grid);
      go(1, 1);
      await settle();
      handle(host)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await settle();
      expect(grid.given.map((request) => request.command.id)).toEqual(["edit.autoFill"]);
      const params = JSON.parse(grid.given[0].command.params);
      expect(params.source).toBe("B2");
      expect(params.target).toMatch(/^B2:B\d+$/);
      engine.destroy();
    });

    it("il bordo di un'intestazione si tira con la guida e dà un comando solo; il doppio clic adatta", async () => {
      const grid = workbookHost();
      const { engine, viewport, host } = await workbookMounted(grid);
      const header = [...host.querySelectorAll<HTMLElement>(".grid-column-header")].find((element) => element.textContent === "B")!;
      const edge = parseFloat(header.style.left) + parseFloat(header.style.width);
      const width = parseFloat(header.style.width);
      press(viewport, "pointermove", edge - 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(true);
      press(viewport, "pointerdown", edge - 2, 10);
      press(viewport, "pointermove", edge + 26, 10);
      expect(host.querySelector(".grid-resize-guide")).not.toBeNull();
      expect(host.querySelector(".grid-resize-label")?.textContent).toMatch(/\(\d+ px\)$/);
      // Il movimento non scrive: si scrive al rilascio, una volta.
      expect(grid.given).toEqual([]);
      press(viewport, "pointerup", edge + 26, 10);
      await settle();
      expect(host.querySelector(".grid-resize-guide")).toBeNull();
      expect(grid.given.map((request) => request.command.id)).toEqual(["home.columnWidth"]);
      expect(JSON.parse(grid.given[0].command.params)).toEqual({ cols: "B:B", width: Math.round((width + 28) / 1.4) });
      // La selezione non è cambiata.
      expect(engine.selection().focus).toEqual({ row: 0, column: 0 });

      viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: edge - 2, clientY: 10 }));
      await settle();
      expect(grid.given[grid.given.length - 1]?.command.id).toBe("home.autofitColumnWidth");
      expect(JSON.parse(grid.given[grid.given.length - 1].command.params)).toEqual({ cols: "B:B" });
      // In mezzo all'intestazione il puntatore torna quello di sempre.
      press(viewport, "pointermove", edge - width / 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(false);
      engine.destroy();
    });

    it("Ctrl+clic aggiunge un intervallo, i comandi li ricevono tutti, e un clic semplice ricomincia", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell } = await workbookMounted(grid);
      const first = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", first.x, first.y);
      press(viewport, "pointerup", first.x, first.y);
      // La colonna D della cartella è nascosta.
      const second = at(cell, 3, 2);
      press(cell(3, 2)!, "pointerdown", second.x, second.y, { ctrlKey: true });
      const corner = at(cell, 4, 4);
      press(viewport, "pointermove", corner.x, corner.y);
      press(viewport, "pointerup", corner.x, corner.y);
      expect(host.querySelectorAll(".grid-selection")).toHaveLength(2);
      expect(cell(1, 1)!.classList.contains("selected")).toBe(true);
      expect(cell(4, 4)!.classList.contains("selected")).toBe(true);
      expect(cell(2, 2)!.classList.contains("selected")).toBe(false);
      expect(engine.command("home.bold")).toBe(true);
      await settle();
      expect(grid.given[0].command.selection).toBe("B2,C4:E5");
      expect(grid.given[0].command.active).toBe("C4");
      // Il quadratino di riempimento non regge più intervalli.
      expect(handle(host)).toBeNull();

      const again = at(cell, 2, 2);
      press(cell(2, 2)!, "pointerdown", again.x, again.y);
      press(viewport, "pointerup", again.x, again.y);
      expect(host.querySelector(".grid-selection")).toBeNull();
      expect(cell(1, 1)!.classList.contains("selected")).toBe(false);
      engine.destroy();
    });

    it("il bordo della selezione si tira per spostarla, e con Ctrl la copia", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell } = await workbookMounted(grid);
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      const end = at(cell, 2, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      // Sul bordo sinistro di B2 il puntatore prende la selezione.
      const edge = { x: start.x - 8, y: start.y };
      press(viewport, "pointermove", edge.x, edge.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(true);
      press(viewport, "pointermove", start.x + 4, start.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(false);

      press(viewport, "pointerdown", edge.x, edge.y);
      const drop = at(cell, 3, 0);
      press(viewport, "pointermove", drop.x, drop.y);
      expect(host.querySelector(".grid-move-preview")).not.toBeNull();
      // La selezione non cambia finché non si lascia.
      expect(engine.selection()).toMatchObject({ anchor: { row: 1, column: 1 }, focus: { row: 2, column: 2 } });
      press(viewport, "pointerup", drop.x, drop.y);
      await settle();
      expect(host.querySelector(".grid-move-preview")).toBeNull();
      const moves = () => grid.given.filter((request) => request.command.id === "fub.pasteFrom");
      expect(moves()).toHaveLength(1);
      expect(JSON.parse(moves()[0].command.params)).toEqual({ source: "B2:C3", sourceSheet: "s1", move: true });
      expect(moves()[0].command.selection).toBe("A4:B5");

      // Con Ctrl al rilascio si copia.
      const again = at(cell, 3, 0);
      press(viewport, "pointerdown", again.x - 8, again.y);
      const copy = at(cell, 1, 1);
      press(viewport, "pointermove", copy.x, copy.y);
      press(viewport, "pointerup", copy.x, copy.y, { ctrlKey: true });
      await settle();
      expect(JSON.parse(moves()[1].command.params)).toEqual({ source: "A4:B5", sourceSheet: "s1", move: false });
      engine.destroy();
    });

    it("una formula aperta prende i riferimenti col puntatore e con le frecce, e li contorna", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, cell, go } = await workbookMounted(grid);
      go(3, 0);
      viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true }));
      const editor = findTextEditorOrThrow(host.querySelector<HTMLElement>(".grid-cell-editor")!);
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "=1+" }, selection: { anchor: 3 } });
      const content = host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!;
      const key = (name: string, init: KeyboardEventInit = {}) =>
        content.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
      // Le frecce partono dalla cella aperta; con Maiuscolo allargano.
      key("ArrowUp");
      expect(editor.state.doc.toString()).toBe("=1+A3");
      key("ArrowUp", { shiftKey: true });
      expect(editor.state.doc.toString()).toBe("=1+A2:A3");
      // Un clic sostituisce il riferimento puntato, un trascinamento lo allarga.
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      expect(editor.state.doc.toString()).toBe("=1+B2");
      const end = at(cell, 2, 2);
      press(viewport, "pointermove", end.x, end.y);
      press(viewport, "pointerup", end.x, end.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3");
      // La cella aperta resta quella, e anche la selezione.
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);
      expect(engine.selection()).toMatchObject({ anchor: { row: 3, column: 0 }, focus: { row: 3, column: 0 } });
      // Dopo un operatore un clic aggiunge un riferimento, di un altro colore.
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: "*" }, selection: { anchor: editor.state.doc.length + 1 } });
      const other = at(cell, 0, 2);
      press(cell(0, 2)!, "pointerdown", other.x, other.y);
      press(viewport, "pointerup", other.x, other.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3*C1");
      await settle();
      expect(host.querySelectorAll(".grid-formula-ref-1")).toHaveLength(1);
      expect(host.querySelectorAll(".grid-formula-ref-2")).toHaveLength(1);
      expect(content.querySelector(".cm-formula-ref-2")?.textContent).toBe("C1");
      // Un altro clic cambia ancora il riferimento appena puntato.
      const first = at(cell, 0, 0);
      press(cell(0, 0)!, "pointerdown", first.x, first.y);
      press(viewport, "pointerup", first.x, first.y);
      expect(editor.state.doc.toString()).toBe("=1+B2:C3*A1");
      key("Enter");
      await settle();
      expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
      expect(host.querySelector(".grid-formula-ref-1")).toBeNull();
      expect(grid.applied[0]?.patches[0]).toMatchObject({ cell: { sheet: "s1", row: "r3", column: "c0" }, after: "=1+B2:C3*A1" });
      engine.destroy();
    });

    it("senza `fub.pasteFrom` il bordo della selezione non si tira", async () => {
      const { engine, viewport, cell } = await workbookMounted(workbookHost({ drop: ["fub.pasteFrom"] }));
      const start = at(cell, 1, 1);
      press(cell(1, 1)!, "pointerdown", start.x, start.y);
      press(viewport, "pointerup", start.x, start.y);
      press(viewport, "pointermove", start.x - 8, start.y, { buttons: 0 });
      expect(viewport.classList.contains("move-selection")).toBe(false);
      engine.destroy();
    });

    it("senza il comando servito il bordo delle intestazioni non si tira", async () => {
      const grid = workbookHost({ drop: ["home.columnWidth"] });
      const { engine, viewport, host } = await workbookMounted(grid);
      const header = [...host.querySelectorAll<HTMLElement>(".grid-column-header")].find((element) => element.textContent === "B")!;
      const edge = parseFloat(header.style.left) + parseFloat(header.style.width);
      press(viewport, "pointermove", edge - 2, 10);
      expect(viewport.classList.contains("resize-column")).toBe(false);
      engine.destroy();
    });

    it("copia e incolla dentro la cartella passano da `fub.pasteFrom`, e un taglio si incolla una volta", async () => {
      const grid = workbookHost();
      const { engine, viewport, host, go } = await workbookMounted(grid);
      const copied = new Map<string, string>();
      const send = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
        });
        viewport.dispatchEvent(event);
      };
      const pastes = () => grid.given.filter((request) => request.command.id === "fub.pasteFrom");
      go(1, 1);
      send("copy");
      go(2, 2);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(1);
      expect(JSON.parse(pastes()[0].command.params)).toEqual({ source: "B2", sourceSheet: "s1", move: false });
      expect(pastes()[0].command.selection).toBe("C3");
      // Ciò che si è copiato si incolla ancora.
      go(3, 0);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(2);

      go(1, 1);
      send("cut");
      expect(host.querySelector(".grid-cut-mark")).not.toBeNull();
      go(3, 2);
      send("paste");
      await settle();
      expect(JSON.parse(pastes()[2].command.params)).toMatchObject({ source: "B2", move: true });
      expect(host.querySelector(".grid-cut-mark")).toBeNull();
      // Il taglio è andato: un altro incolla scrive il testo, senza spostare.
      go(2, 0);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(3);

      // Un testo che non è quello copiato viene da fuori.
      go(1, 1);
      send("copy");
      copied.set("text/plain", "altro");
      go(2, 2);
      send("paste");
      await settle();
      expect(pastes()).toHaveLength(3);
      engine.destroy();
    });

    it("senza `fub.pasteFrom` l'incolla scrive gli input", async () => {
      const grid = workbookHost({ drop: ["fub.pasteFrom"] });
      const { engine, viewport, go } = await workbookMounted(grid);
      const copied = new Map<string, string>();
      const send = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", {
          value: { getData: (kind: string) => copied.get(kind) ?? "", setData: (kind: string, text: string) => { copied.set(kind, text); } },
        });
        viewport.dispatchEvent(event);
      };
      go(1, 1);
      send("copy");
      go(2, 2);
      send("paste");
      await settle();
      expect(grid.given.some((request) => request.command.id === "fub.pasteFrom")).toBe(false);
      expect(grid.applied.flatMap((request) => request.patches).some((patch) => patch.cell.row === "r2" && patch.cell.column === "c2")).toBe(true);
      engine.destroy();
    });

    it("senza `edit.autoFill` nel catalogo non c'è il quadratino", async () => {
      const { engine, host, go } = await workbookMounted(workbookHost({ drop: ["edit.autoFill"] }));
      go(1, 1);
      await settle();
      expect(handle(host)).toBeNull();
      engine.destroy();
    });
  });

  async function widened(viewport: HTMLElement) {
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 3_000 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 1_200 });
    viewport.dispatchEvent(new Event("scroll"));
    await settle();
  }

  const objectAt = (host: HTMLElement, key: string) =>
    [...host.querySelectorAll<HTMLElement>(".grid-object")].find((element) => element.dataset.object === key);

  it("disegna gli oggetti sopra le celle, li riassume e tiene le immagini una volta", async () => {
    const plain = workbookHost();
    const requests: GridWindowRequest[] = [];
    const grid = {
      ...plain,
      host: {
        ...plain.host,
        gridBytesWindow: async (surface: string, instance: string, request: GridWindowRequest) => {
          requests.push(structuredClone(request));
          const answer = await plain.host.gridBytesWindow(surface, instance, request);
          // Come il provider: un'immagine che la shell ha già arriva senza i byte.
          for (const object of answer.objects) {
            if (object.media && request.known_media.includes(object.media.key)) object.media.data = null;
          }
          return answer;
        },
      },
    };
    const { engine, host, viewport } = await workbookMounted(grid);
    expect(requests[0].known_media).toEqual([]);
    const summary = host.querySelector<HTMLElement>("#grid-xlsx-objects")!;
    expect(viewport.getAttribute("aria-describedby")).toBe(summary.id);
    for (const name of ["Il sole", "Conti di casa", "Importi"]) expect(summary.textContent).toContain(name);

    await widened(viewport);
    const objects = [...host.querySelectorAll<HTMLElement>(".grid-object")];
    // Nell'ordine in cui si disegnano: il grafico sopra la forma e l'immagine.
    expect(objects.map((element) => element.dataset.object)).toEqual(["image:1", "shape:2", "chart:3"]);
    expect(objects.every((element) => element.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(objectAt(host, "image:1")!.querySelector("img")!.src).toMatch(/^data:image\/png;base64,iVBOR/u);
    expect(objectAt(host, "chart:3")!.querySelector("img")!.src).toMatch(/^data:image\/svg\+xml/u);
    const text = objectAt(host, "shape:2")!.querySelector<HTMLElement>(".grid-object-text")!;
    expect(text.textContent).toBe("Conti di casa");
    expect(text.style.fontWeight).toBe("700");

    // Dopo un comando la griglia rilegge, e dice all'host l'immagine che ha
    // già: arriva senza i byte, e resta.
    const media = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "image")!.media!.key;
    const before = requests.length;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "5", code: "Digit5", ctrlKey: true, altKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await settle();
    await settle();
    expect(requests.length).toBeGreaterThan(before);
    const last = requests.filter((request) => request.sheet === "s1").pop()!;
    expect(last.known_media).toEqual([media]);
    expect(objectAt(host, "image:1")!.querySelector("img")!.src).toMatch(/^data:image\/png;base64,/u);
    engine.destroy();
    expect(host.querySelector(".grid-object")).toBeNull();
  });

  it("seleziona gli oggetti dalla tastiera, li sposta e li cancella con i comandi", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    const key = (init: KeyboardEventInit) => viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    expect(engine.selectedObject()?.kind).toBe("image");
    const announce = host.querySelector<HTMLElement>(".grid-surface [role=status]:not(.grid-notice)");
    expect(announce?.textContent).toContain("Il sole");
    const selected = objectAt(host, "image:1")!;
    expect(selected.classList.contains("selected")).toBe(true);
    expect(selected.querySelectorAll(".grid-object-handle")).toHaveLength(8);

    key({ key: "Tab" });
    expect(engine.selectedObject()?.kind).toBe("shape");
    // Una lettera non apre la cella sotto l'oggetto.
    key({ key: "x" });
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    key({ key: "ArrowRight", shiftKey: true });
    await settle();
    const shape = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "shape")!;
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move"]);
    expect(JSON.parse(grid.given[0].command.params)).toEqual({
      kind: "shape", id: shape.id, at: "J6", dx: 10, dy: 0, width: shape.width, height: shape.height,
    });

    key({ key: "Delete" });
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move", "object.delete"]);
    expect(JSON.parse(grid.given[1].command.params)).toEqual({ kind: "shape", id: shape.id });
    expect(engine.selectedObject()).toBeNull();

    key({ key: "5", code: "Digit5", ctrlKey: true, altKey: true });
    key({ key: "Escape" });
    expect(engine.selectedObject()).toBeNull();
    expect(host.querySelector(".grid-object.selected")).toBeNull();
    engine.destroy();
  });

  it("sposta e misura un oggetto col puntatore, e un clic non lo sposta", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    const pointer = (target: EventTarget, type: string, x: number, y: number, extra: PointerEventInit = {}) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, ...extra }));
    const chart = (xlsx.windows as GridBytesWindow[])[0].objects.find((object) => object.kind === "chart")!;

    pointer(objectAt(host, "chart:3")!, "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 101, 101);
    pointer(viewport, "pointerup", 101, 101);
    await settle();
    expect(engine.selectedObject()?.kind).toBe("chart");
    expect(grid.given).toEqual([]);

    pointer(objectAt(host, "chart:3")!.querySelector(".grid-object-handle.se")!, "pointerdown", 100, 100);
    pointer(viewport, "pointermove", 100 + 14, 100 + 28);
    // Mentre si tira, l'oggetto segue il puntatore.
    expect(objectAt(host, "chart:3")!.style.width).not.toBe("");
    pointer(viewport, "pointerup", 100 + 14, 100 + 28);
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["object.move"]);
    const params = JSON.parse(grid.given[0].command.params);
    expect(params).toMatchObject({ kind: "chart", id: chart.id, at: "J10", dx: 0, dy: 0 });
    expect(params.width).toBeCloseTo(chart.width + 10, 1);
    expect(params.height).toBeCloseTo(chart.height + 20, 1);
    engine.destroy();
  });

  it("seleziona l'oggetto che un comando ha appena inserito", async () => {
    const plain = workbookHost();
    const grid = {
      ...plain,
      host: {
        ...plain.host,
        gridBytesCommand: async (...args: Parameters<GridHost["gridBytesCommand"]>) => {
          const outcome = await plain.host.gridBytesCommand(...args);
          return args[2].command.id === "insert.textBox" ? { ...outcome, result: JSON.stringify({ shape: 2 }) } : outcome;
        },
      },
    };
    const { engine, viewport } = await workbookMounted(grid);
    await widened(viewport);
    expect(engine.command("insert.textBox")).toBe(true);
    await settle();
    await settle();
    expect(engine.selectedObject()?.kind).toBe("shape");
    // Un altro comando non cambia la selezione.
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(engine.command("home.bold")).toBe(true);
    await settle();
    await settle();
    expect(engine.selectedObject()).toBeNull();
    engine.destroy();
  });

  it("scrive il testo di una casella sul posto con shape.setText", async () => {
    const grid = workbookHost();
    const { engine, host, viewport } = await workbookMounted(grid);
    await widened(viewport);
    objectAt(host, "shape:2")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const field = host.querySelector<HTMLTextAreaElement>(".grid-object-text-editor")!;
    expect(field.value).toBe("Conti di casa");
    // Esc lascia il testo com'era.
    field.value = "Spese";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(host.querySelector(".grid-object-text-editor")).toBeNull();
    expect(grid.given).toEqual([]);

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const again = host.querySelector<HTMLTextAreaElement>(".grid-object-text-editor")!;
    again.value = "Spese di casa";
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(grid.given.map((request) => request.command.id)).toEqual(["shape.setText"]);
    expect(JSON.parse(grid.given[0].command.params)).toEqual({ id: 2, text: "Spese di casa" });
    engine.destroy();
  });
});
