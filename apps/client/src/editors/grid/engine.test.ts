// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTextEditorOrThrow } from "../text/test-support";
import { applyOperation } from "../core/text-operation";
import { parseWorkbook } from "./model";
import { commitGridPatches, inputPatch, isGridOperation, type GridCellPatch } from "./operation";
import type { GridWindow } from "../../host/contract";
import { GridEngine, type GridChange, type GridHost } from "./engine";

function workbook(rows = 100, columns = 50): string {
  return JSON.stringify({
    version: 1,
    sheets: [{
      id: "main",
      name: "Main",
      rows: Array.from({ length: rows }, (_, index) => ({ id: `r${index}`, hidden: false })),
      columns: Array.from({ length: columns }, (_, index) => ({ id: `c${index}`, hidden: false })),
      cells: [{ row: "r0", column: "c0", input: "1" }],
    }],
  });
}

/** Le patch di un commit: soltanto le conferme del provider ne sono senza. */
function patchesOf(change: GridChange): readonly GridCellPatch[] {
  if (!isGridOperation(change.operation)) throw new Error("un commit senza patch di celle");
  return change.operation.patches;
}

function mounted(
  grid?: GridHost,
  source = workbook(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const changes: GridChange[] = [];
  const engine = new GridEngine(host, {
    surfaceId: "test",
    formatId: "fubsheet",
    revision: "rev-1",
    onChange: (change) => changes.push(change),
    onSelectionChange: () => {},
    grid,
  });
  const viewport = host.querySelector<HTMLElement>(".grid-viewport")!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 300 },
  });
  engine.setDoc(source);
  return { engine, host, viewport, changes };
}
function protocolHost(
  source: string,
  onClose?: (instance: string) => void,
): GridHost & {
  calls: string[];
  openedInstances: string[];
  closedInstances: string[];
  activeInstances: Set<string>;
} {
  const calls: string[] = [];
  const openedInstances: string[] = [];
  const closedInstances: string[] = [];
  const activeInstances = new Set<string>();
  let openCount = 0;
  let value = "1";
  let currentRevision = "rev-1";
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: `r${index}`, index, height: null, hidden: false }));
  const columns = Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, index, width: null, hidden: false }));
  const window = () => ({
    revision: currentRevision,
    sheet: "main",
    row_start: 0,
    column_start: 0,
    total_rows: 100,
    total_columns: 50,
    rows,
    columns,
    cells: [{
      key: { sheet: "main", row: "r0", column: "c0" },
      input: value,
      style: { bold: false, italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
      value: { kind: "number" as const, value: Number(value === "1" ? 1 : 2) },
    }],
  });
  const start = new TextEncoder().encode(source.slice(0, source.indexOf('"1"'))).length;
  return {
    calls,
    openedInstances,
    closedInstances,
    activeInstances,
    listGridSurfaces: async () => {
      calls.push("list");
      return [{ id: "sheet", format: "fubsheet", family: "grid", protocol_version: 1 }];
    },
    openGrid: async () => {
      calls.push("open");
      openCount += 1;
      const instance = `grid-test-${openCount}`;
      openedInstances.push(instance);
      activeInstances.add(instance);
      return {
        instance,
        revision: currentRevision,
        sheets: [{ id: "main", name: "Main", row_count: 100, column_count: 50 }],
      };
    },
    gridWindow: async (_surface, _instance, _request) => { calls.push("window"); return window(); },
    applyGrid: async () => {
      calls.push("apply");
      value = "X";
      currentRevision = "rev-2";
      return {
        revision: currentRevision,
        edit: { from: start, to: start + 3, deleted: '"1"', inserted: '"X"' },
        invalidation: { kind: "cells", cells: [{ sheet: "main", row: "r0", column: "c0" }] },
      };
    },
    reloadGrid: async (_surface, _instance, _source, _revision) => {
      calls.push("reload");
      return {
        instance: openedInstances[openedInstances.length - 1] ?? "grid-test-missing",
        revision: currentRevision,
        sheets: [{ id: "main", name: "Main", row_count: 100, column_count: 50 }],
      };
    },
    closeGrid: async (_surface, instance) => {
      calls.push("close");
      closedInstances.push(instance);
      activeInstances.delete(instance);
      onClose?.(instance);
    },
  };
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
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
}

/**
 * Un provider che tiene il **suo** sorgente, compatto, e risponde a ogni
 * commit col diff minimo da quello: come il nativo, che riscrive il workbook
 * coi suoi byte. Le risposte restano in attesa finché il test non le libera.
 */
function bytewiseProvider(source: string) {
  const grid = protocolHost(source);
  let held = source;
  const answers: Array<() => void> = [];
  Object.assign(grid, {
    applyGrid: async (_surface: string, _instance: string, request: { patches: Array<{ after: string }> }) => {
      grid.calls.push("apply");
      await new Promise<void>((resolve) => answers.push(resolve));
      // Sul testo e non attraverso `JSON.parse`: il nativo conserva ciò che
      // non tocca, interi oltre la precisione di `Number` compresi.
      const next = held.replace(/"input":"[^"]*"/, `"input":${JSON.stringify(request.patches[0]!.after)}`);
      let from = 0;
      while (from < held.length && held[from] === next[from]) from += 1;
      let tail = 0;
      while (tail < held.length - from && held[held.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
      const bytes = (text: string) => new TextEncoder().encode(text).length;
      const edit = {
        from: bytes(held.slice(0, from)),
        to: bytes(held.slice(0, held.length - tail)),
        deleted: held.slice(from, held.length - tail),
        inserted: next.slice(from, next.length - tail),
      };
      held = next;
      return { revision: `rev-${answers.length + 2}`, edit, invalidation: { kind: "cells", cells: [] } };
    },
  });
  return { grid, answers, held: () => held };
}

describe("GridEngine", () => {
  it("virtualizza entro una finestra limitata e pubblica la semantica grid", () => {
    const { engine, host, viewport } = mounted();
    expect(viewport.getAttribute("role")).toBe("grid");
    expect(viewport.getAttribute("aria-rowcount")).toBe("101");
    expect(viewport.getAttribute("aria-colcount")).toBe("51");
    expect(engine.renderedCellCount()).toBeLessThan(200);
    expect(host.querySelectorAll(".grid-cell").length).toBe(engine.renderedCellCount());

    viewport.scrollTop = 1_400;
    viewport.dispatchEvent(new Event("scroll"));
    const renderedRows = [...host.querySelectorAll<HTMLElement>(".grid-cell")]
      .map((cell) => Number(cell.dataset.row));
    expect(Math.min(...renderedRows)).toBeGreaterThan(40);
    expect(engine.renderedCellCount()).toBeLessThan(200);
    engine.destroy();
  });
  it("annida ogni intestazione e cella alla propria riga semantica", () => {
    const { engine, viewport } = mounted();
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

  it("tiene le battute locali e pubblica una sola operazione al commit", () => {
    const { engine, host, viewport, changes } = mounted();

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(changes).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(false);

    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(patchesOf(changes[0])).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("X");
    engine.destroy();
  });

  it("incolla TSV come una sola operazione e mantiene undo locale separato dal peer", () => {
    const { engine, viewport, changes } = mounted();
    const clipboard = {
      getData: () => "A\tB\nC\tD",
      setData: vi.fn(),
    };
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    viewport.dispatchEvent(paste);
    expect(changes).toHaveLength(1);
    expect(patchesOf(changes[0])).toHaveLength(4);

    const peerWorkbook = parseWorkbook(engine.getDoc());
    const peerPatch = inputPatch(peerWorkbook.sheets[0], { row: 2, column: 2 }, "peer")!;
    const peer = commitGridPatches(peerWorkbook, engine.getDoc(), [peerPatch])!;
    engine.syncDoc({ text: peer.source, operation: peer.operation });

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    const afterUndo = parseWorkbook(engine.getDoc()).sheets[0];
    expect(afterUndo.cells?.find((cell) => cell.row === "r0" && cell.column === "c0")?.input).toBe("1");
    expect(afterUndo.cells?.find((cell) => cell.row === "r2" && cell.column === "c2")?.input).toBe("peer");
    expect(changes).toHaveLength(2);
    expect(changes[1].origin).toBe("undo");
    engine.destroy();
  });
  it("negozia Grid v1, non chiama l'host per battuta e applica il diff guardato", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const { engine, host, viewport, changes } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const windowsBeforeTyping = grid.calls.filter((call) => call === "window").length;
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(0);
    host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "window").length).toBeGreaterThan(windowsBeforeTyping);
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(1);
    // Il commit arriva alla sessione all'invio, scritto qui; la conferma del
    // provider lo riscrive coi suoi byte, e la seconda modifica parte dalla prima.
    expect(changes).toHaveLength(2);
    expect(parseWorkbook(changes[0].text).sheets[0].cells?.[0].input).toBe("X");
    expect(changes[1].text).toBe(source.replace('"1"', '"X"'));
    expect(applyOperation(changes[0].text, changes[1].operation)).toBe(changes[1].text);
    expect(engine.getDoc()).toBe(changes[1].text);
    engine.destroy();
  });

  it("risolve l'invalidazione sulle coordinate globali senza degradare gli ID sconosciuti", async () => {
    const sourceValue = JSON.parse(workbook(512, 256)) as {
      sheets: [{ cells: { row: string; column: string; input: string }[] }];
    };
    sourceValue.sheets[0].cells.push({ row: "r300", column: "c200", input: "old" });
    const source = JSON.stringify(sourceValue);
    const grid = protocolHost(source);
    const requests: { row_start: number; column_start: number }[] = [];
    const open = grid.openGrid;
    const targetStart = new TextEncoder().encode(source.slice(0, source.indexOf('"old"'))).length;
    let revision = "rev-1";
    Object.assign(grid, {
      openGrid: async (surface: string, text: string, requestedRevision: string) => {
        const session = await open(surface, text, requestedRevision);
        return {
          ...session,
          revision,
          sheets: [{ id: "main", name: "Main", row_count: 512, column_count: 256 }],
        };
      },
      gridWindow: async (
        _surface: string,
        _instance: string,
        request: Parameters<GridHost["gridWindow"]>[2],
      ) => {
        requests.push({ row_start: request.row_start, column_start: request.column_start });
        grid.calls.push("window");
        const rows = Array.from({ length: request.row_count }, (_, offset) => ({
          id: `r${request.row_start + offset}`,
          index: request.row_start + offset,
          height: null,
          hidden: false,
        }));
        const columns = Array.from({ length: request.column_count }, (_, offset) => ({
          id: `c${request.column_start + offset}`,
          index: request.column_start + offset,
          width: null,
          hidden: false,
        }));
        const cells: GridWindow["cells"] = [];
        if (request.row_start === 0 && request.column_start === 0) {
          cells.push({
            key: { sheet: "main", row: "r0", column: "c0" },
            input: revision === "rev-2" ? "corrupt" : "1",
            style: { bold: false, italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
            value: { kind: "number" as const, value: 1 },
          });
        }
        if (
          request.row_start <= 300
          && 300 < request.row_start + request.row_count
          && request.column_start <= 200
          && 200 < request.column_start + request.column_count
        ) {
          cells.push({
            key: { sheet: "main", row: "r300", column: "c200" },
            input: revision === "rev-2" ? "new" : "old",
            style: { bold: revision === "rev-2", italic: false, text_color: null, fill_color: null, horizontal: null, number_format: null },
            value: { kind: "number" as const, value: revision === "rev-2" ? 99 : 1 },
          });
        }
        return {
          revision,
          sheet: "main",
          row_start: request.row_start,
          column_start: request.column_start,
          total_rows: 512,
          total_columns: 256,
          rows,
          columns,
          cells,
        };
      },
      applyGrid: async () => {
        revision = "rev-2";
        return {
          revision,
          edit: { from: targetStart, to: targetStart + 5, deleted: '"old"', inserted: '"new"' },
          invalidation: {
            kind: "cells" as const,
            cells: [
              { sheet: "main", row: "r300", column: "c200" },
              { sheet: "main", row: "missing-row", column: "missing-column" },
            ],
          },
        };
      },
    });
    const { engine, host, viewport } = mounted(grid, source);
    for (let index = 0; index < 12; index += 1) await Promise.resolve();

    viewport.scrollTop = 300 * 28;
    viewport.scrollLeft = 200 * 120;
    viewport.dispatchEvent(new Event("scroll"));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.textContent).toBe("1");

    const target = host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')!;
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    const requestsBeforeInvalidation = requests.length;
    const formula = findTextEditorOrThrow(
      host.querySelector<HTMLElement>(".grid-formula-editor")!,
    );
    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "new" },
      userEvent: "input",
    });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    expect(requests.slice(requestsBeforeInvalidation)).toEqual([{ row_start: 256, column_start: 128 }]);
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.textContent).toBe("99");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="300"][data-column="200"]')?.style.fontWeight).toBe("700");
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.find((cell) => cell.row === "r0" && cell.column === "c0")?.input)
      .toBe("1");
    engine.destroy();
  });
  it("estende la selezione da tastiera e ripristina il fuoco dopo Escape", async () => {
    const { engine, host, viewport } = mounted();
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
    const { engine, host, viewport, changes } = mounted();
    const formula = findTextEditorOrThrow(
      host.querySelector<HTMLElement>(".grid-formula-editor")!,
    );

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "7" },
      userEvent: "input",
    });
    expect(changes).toHaveLength(0);
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("7");

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "8" },
      userEvent: "input",
    });
    formula.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(changes).toHaveLength(1);
    await Promise.resolve();
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("7");

    formula.focus();
    formula.dispatch({
      changes: { from: 0, to: formula.state.doc.length, insert: "9" },
      userEvent: "input",
    });
    viewport.focus();
    await Promise.resolve();
    expect(changes).toHaveLength(2);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("9");
    engine.destroy();
  });

  it("copia e incolla una cella multilinea al suo posto senza toccare le vicine", () => {
    const multiline = "prima\nseconda\tterza";
    const source = JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r0", hidden: false }, { id: "r1", hidden: false }],
        columns: [{ id: "c0", hidden: false }, { id: "c1", hidden: false }],
        cells: [
          { row: "r0", column: "c0", input: multiline },
          { row: "r0", column: "c1", input: "B1" },
          { row: "r1", column: "c0", input: "A2" },
          { row: "r1", column: "c1", input: "B2" },
        ],
      }],
    });
    const { engine, viewport, changes } = mounted(undefined, source);
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

    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.map((cell) => cell.input)).toEqual([multiline, "B1", "A2", "B2"]);
    expect(changes).toHaveLength(0);
    expect(copied).toBe('"prima\nseconda\tterza"\n');
    expect(engine.selectedText()).toEqual({ primary: multiline, secondary: [] });
    engine.destroy();
  });

  it("dice l'intervallo scelto come testo da leggere, fino a un tetto", () => {
    const { engine, viewport } = mounted();
    expect(engine.selectedText()).toEqual({ primary: "1", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(engine.selectedText()).toEqual({ primary: "1\t\n\t", secondary: [] });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    // Cento righe per cinquanta colonne: sotto il tetto di diecimila celle.
    expect(engine.selectedText()?.primary.split("\n")).toHaveLength(100);
    engine.destroy();
    expect(engine.selectedText()).toBeNull();

    const large = mounted(undefined, workbook(200, 60));
    large.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    expect(large.engine.selectedText()).toBeNull();
    large.engine.destroy();
  });

  it("barra delle formule ed editor di cella sono campi, non documenti", () => {
    const { engine, host } = mounted();
    for (const selector of [".grid-formula-editor", ".grid-cell-editor"]) {
      const field = host.querySelector<HTMLElement>(selector)!;
      expect(field.querySelector(".cm-lineNumbers")).toBeNull();
      expect(findTextEditorOrThrow(field).contentDOM.getAttribute("spellcheck")).toBe("false");
    }
    engine.destroy();
  });

  it("annulla la bozza locale quando un full-text peer ricarica la topologia", () => {
    const { engine, host, viewport, changes } = mounted();
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    const peer = JSON.parse(workbook());
    peer.sheets[0].cells[0].input = "peer";

    engine.syncDoc(JSON.stringify(peer));

    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("peer");
    expect(changes).toHaveLength(0);
    engine.destroy();
  });
  it("salta gli assi nascosti e avvolge Tab sulla riga visibile successiva", () => {

    const { engine, viewport } = mounted();
    const source = JSON.parse(workbook(3, 3));
    source.sheets[0].rows[0].hidden = true;
    source.sheets[0].columns[1].hidden = true;
    engine.setDoc(JSON.stringify(source));

    expect(engine.selection().focus).toEqual({ row: 1, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 2, column: 0 });
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(engine.selection().focus).toEqual({ row: 1, column: 2 });
    engine.destroy();
  });
  it("lascia uscire Tab ai bordi senza intrappolare il fuoco", () => {
    const { engine, viewport } = mounted(undefined, workbook(1, 2));
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


  it("non espone un discendente attivo quando ogni asse è nascosto", () => {
    const { engine, host, viewport, changes } = mounted();
    const source = JSON.parse(workbook(1, 1));
    source.sheets[0].rows[0].hidden = true;
    source.sheets[0].columns[0].hidden = true;
    engine.setDoc(JSON.stringify(source));

    expect(viewport.hasAttribute("aria-activedescendant")).toBe(false);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    expect(host.querySelector<HTMLElement>(".grid-cell-editor")!.hidden).toBe(true);
    expect(changes).toHaveLength(0);
    engine.destroy();
  });


  it("sceglie deterministicamente la prima superficie compatibile dichiarata", async () => {
    const grid = protocolHost(workbook());
    let selected: string | null = null;
    const open = grid.openGrid;
    Object.assign(grid, {
      listGridSurfaces: async () => [
        { id: "first", format: "fubsheet", family: "grid", protocol_version: 1 },
        { id: "second", format: "fubsheet", family: "grid", protocol_version: 1 },
      ],
      openGrid: async (surface: string, source: string, revision: string) => {
        selected = surface;
        return open(surface, source, revision);
      },
    });
    const { engine } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(selected).toBe("first");
    engine.destroy();
  });

  it("chiude prima del teardown e riapre con un'istanza nuova senza residui", async () => {
    let mountedAtClose = false;
    const grid = protocolHost(workbook(), () => {
      mountedAtClose = document.querySelector(".grid-surface") !== null;
    });
    const first = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    first.engine.destroy();
    expect(grid.openedInstances).toEqual(["grid-test-1"]);
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances.size).toBe(0);
    expect(mountedAtClose).toBe(true);
    expect(first.host.querySelector(".grid-surface")).toBeNull();

    const second = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.openedInstances).toEqual(["grid-test-1", "grid-test-2"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    const callsAfterSecondOpen = grid.calls.length;
    first.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await Promise.resolve();
    expect(grid.calls.length).toBe(callsAfterSecondOpen);
    expect(grid.closedInstances).toEqual(["grid-test-1"]);

    second.engine.destroy();
    expect(grid.closedInstances).toEqual(["grid-test-1", "grid-test-2"]);
    expect(grid.activeInstances.size).toBe(0);
    expect(second.host.querySelector(".grid-surface")).toBeNull();
    const callsAfterDestroy = grid.calls.length;
    second.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    await Promise.resolve();
    expect(grid.calls.length).toBe(callsAfterDestroy);
  });
  it("legge solo il viewport anche con assi da centomila righe", async () => {
    const grid = protocolHost(workbook(1, 1));
    const open = grid.openGrid;
    Object.assign(grid, {
      openGrid: async (surface: string, source: string, revision: string) => {
        const session = await open(surface, source, revision);
        return {
          ...session,
          sheets: [{ id: "main", name: "Main", row_count: 100_000, column_count: 1_000 }],
        };
      },
      gridWindow: async (_surface: string, _instance: string, request: {
        revision: string;
        sheet: string;
        row_start: number;
        row_count: number;
        column_start: number;
        column_count: number;
      }) => {
        grid.calls.push("window");
        return {
          revision: request.revision,
          sheet: request.sheet,
          row_start: request.row_start,
          column_start: request.column_start,
          total_rows: 100_000,
          total_columns: 1_000,
          rows: Array.from({ length: request.row_count }, (_, index) => ({
            id: `r${request.row_start + index}`,
            index: request.row_start + index,
            height: null,
            hidden: false,
          })),
          columns: Array.from({ length: request.column_count }, (_, index) => ({
            id: `c${request.column_start + index}`,
            index: request.column_start + index,
            width: null,
            hidden: false,
          })),
          cells: [],
        };
      },
    });
    const { engine, viewport } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialWindows = grid.calls.filter((call) => call === "window").length;
    expect(initialWindows).toBeLessThanOrEqual(4);
    viewport.scrollTop = 90_000 * 28;
    viewport.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "window").length).toBeLessThanOrEqual(initialWindows + 4);
    engine.destroy();
  });

  it("rifiuta famiglia o versione sconosciuta prima di aprire una sessione", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, {
      listGridSurfaces: async () => [
        { id: "wrong-family", format: "fubsheet", family: "other", protocol_version: 1 },
        { id: "wrong-version", format: "fubsheet", family: "grid", protocol_version: 2 },
      ],
    });
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "open")).toHaveLength(0);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    engine.destroy();
  });

  it("chiude la sessione se il provider cade nella prima finestra", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, {
      gridWindow: async () => {
        throw new Error("provider trap");
      },
    });
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "open")).toHaveLength(1);
    expect(grid.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    engine.destroy();
  });

  it("chiude la sessione e ricostruisce il fallback se reload fallisce", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const { engine, host } = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    Object.assign(grid, {
      reloadGrid: async () => {
        throw new Error("provider trap");
      },
    });
    const next = JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r0" }],
        columns: [{ id: "c0" }],
        cells: [{ row: "r0", column: "c0", input: "reloaded" }],
      }],
    });
    engine.syncDoc(next);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(engine.getDoc()).toBe(next);
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    expect(host.querySelector<HTMLElement>('.grid-cell[data-row="0"][data-column="0"]')!.textContent)
      .toBe("reloaded");
    engine.destroy();
  });

  it("ignora un reload stantio senza chiudere la nuova istanza", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const current = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let rejectReload: ((reason?: unknown) => void) | undefined;
    Object.assign(grid, {
      reloadGrid: async () => new Promise<never>((_resolve, reject) => {
        rejectReload = reject;
      }),
    });
    const stale = JSON.stringify({
      version: 1,
      sheets: [{
        id: "main",
        name: "Main",
        rows: [{ id: "r0" }],
        columns: [{ id: "c0" }],
        cells: [{ row: "r0", column: "c0", input: "stale" }],
      }],
    });
    current.engine.syncDoc(stale);
    await Promise.resolve();
    const fresh = workbook(2, 2);
    current.engine.setDoc(fresh);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    rejectReload?.(new Error("stale reload"));
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    expect(current.engine.getDoc()).toBe(fresh);
    expect(current.host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("v1");
    current.engine.destroy();
  });

  it("consegna il commit alla sessione all'invio, anche se la linguetta si chiude prima della risposta", async () => {
    const source = workbook();
    const { grid, answers } = bytewiseProvider(source);
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();

    typeInActiveCell(host, viewport, "X");

    // Prima di ogni risposta: la sessione ha già il commit, e diventa sporca.
    expect(changes).toHaveLength(1);
    expect(parseWorkbook(changes[0].text).sheets[0].cells?.[0].input).toBe("X");
    await settle();
    expect(grid.calls.filter((call) => call === "apply")).toHaveLength(1);
    engine.destroy();
    answers.forEach((answer) => answer());
    await settle();
    // Dopo il teardown niente: il riquadro può già mostrare un altro documento.
    expect(changes).toHaveLength(1);
  });

  it("applica le risposte accodate al sorgente del provider e corregge una volta sola", async () => {
    const source = workbook();
    const { grid, answers, held } = bytewiseProvider(source);
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();

    typeInActiveCell(host, viewport, "2");
    typeInActiveCell(host, viewport, "3");
    expect(changes.map((change) => parseWorkbook(change.text).sheets[0].cells?.[0].input)).toEqual(["2", "3"]);
    await settle();
    answers.shift()!();
    await settle();
    // La prima conferma non contiene ancora il secondo commit: non si corregge.
    expect(changes).toHaveLength(2);
    answers.shift()!();
    await settle();

    expect(changes).toHaveLength(3);
    expect(changes[2].text).toBe(held());
    expect(applyOperation(changes[1].text, changes[2].operation)).toBe(changes[2].text);
    expect(engine.getDoc()).toBe(held());
    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("v1");
    engine.destroy();
  });

  it("ricarica il provider soltanto dopo l'apply in volo", async () => {
    const source = workbook();
    const { grid, answers } = bytewiseProvider(source);
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();
    typeInActiveCell(host, viewport, "X");
    await settle();

    const peer = parseWorkbook(changes[0].text);
    const patch = inputPatch(peer.sheets[0], { row: 1, column: 1 }, "peer")!;
    const synced = commitGridPatches(peer, changes[0].text, [patch])!;
    engine.syncDoc({ text: synced.source, operation: synced.operation });
    await settle();
    // L'apply in volo cambierebbe il sorgente del provider sotto la ricarica.
    expect(grid.calls.filter((call) => call === "reload")).toHaveLength(0);
    answers.shift()!();
    await settle();

    expect(grid.calls.filter((call) => call === "reload")).toHaveLength(1);
    expect(changes).toHaveLength(1);
    expect(engine.getDoc()).toBe(synced.source);
    engine.destroy();
  });

  it("una modifica di cella non arrotonda le proprietà, in fallback e con commit accodati", async () => {
    const big = "9007199254740993";
    const source = workbook().replace('{"version":1,', `{"version":1,"properties":{"numero":${big}},`);
    expect(source).toContain(big);

    const fallback = mounted(undefined, source);
    typeInActiveCell(fallback.host, fallback.viewport, "2");
    expect(fallback.changes).toHaveLength(1);
    expect(fallback.changes[0].text).toContain(big);
    fallback.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(fallback.changes[1].origin).toBe("undo");
    expect(fallback.changes[1].text).toContain(big);
    expect(parseWorkbook(fallback.changes[1].text).sheets[0].cells?.[0].input).toBe("1");
    fallback.engine.destroy();

    const { grid, answers } = bytewiseProvider(source);
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();
    typeInActiveCell(host, viewport, "2");
    typeInActiveCell(host, viewport, "3");
    await settle();
    answers.shift()!();
    await settle();
    answers.shift()!();
    await settle();
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (const change of changes) expect(change.text).toContain(big);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("3");
    engine.destroy();
  });

  it("un provider che rifiuta il commit lascia il fallback col commit dentro", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    Object.assign(grid, { applyGrid: async () => { throw new Error("provider caduto"); } });
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();

    typeInActiveCell(host, viewport, "X");
    await settle();

    expect(host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("fallback");
    expect(changes).toHaveLength(1);
    expect(engine.getDoc()).toBe(changes[0].text);
    expect(parseWorkbook(engine.getDoc()).sheets[0].cells?.[0].input).toBe("X");
    engine.destroy();
  });

  it("riapre il provider se un commit in fallback cambia il testo mentre si apriva", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const opened: string[] = [];
    const openGrid = grid.openGrid;
    let release: (() => void) | undefined;
    Object.assign(grid, {
      openGrid: async (surface: string, text: string, revision: string) => {
        opened.push(text);
        if (opened.length === 1) await new Promise<void>((resolve) => { release = resolve; });
        return openGrid(surface, text, revision);
      },
    });
    const { engine, host, viewport, changes } = mounted(grid, source);
    await settle();

    typeInActiveCell(host, viewport, "X");
    expect(changes).toHaveLength(1);
    release?.();
    await settle();

    expect(opened).toEqual([source, changes[0].text]);
    expect(grid.activeInstances.size).toBe(1);
    expect(engine.getDoc()).toBe(changes[0].text);
    engine.destroy();
  });

  it("ignora il rifiuto di un apply stantio senza abbattere il provider nuovo", async () => {
    const source = workbook();
    const grid = protocolHost(source);
    const current = mounted(grid);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let rejectApply: ((reason?: unknown) => void) | undefined;
    Object.assign(grid, {
      applyGrid: async () => new Promise<never>((_resolve, reject) => {
        rejectApply = reject;
      }),
    });
    current.viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "X", bubbles: true }));
    current.host.querySelector<HTMLElement>(".grid-cell-editor .cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    const fresh = workbook(2, 2);
    current.engine.setDoc(fresh);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    rejectApply?.(new Error("stale apply"));
    await Promise.resolve();
    await Promise.resolve();
    expect(grid.closedInstances).toEqual(["grid-test-1"]);
    expect(grid.activeInstances).toEqual(new Set(["grid-test-2"]));
    expect(current.engine.getDoc()).toBe(fresh);
    expect(current.host.querySelector<HTMLElement>(".grid-surface")!.dataset.gridProtocol).toBe("v1");
    current.engine.destroy();
  });

});
